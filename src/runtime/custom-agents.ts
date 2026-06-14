import { z } from "zod";
import { DataEditOperation } from "../agents/data-editor";
import { toJsonSchema } from "../agents/json-schema";
import { parseLLMJson } from "../agents/parse-llm-json";
import { getProvider, loadConfig } from "../config";
import {
  getConversation,
  type NewConversationContext,
} from "../db/conversations";
import {
  type LearningAgentMeta,
  listRuntimeLearningAgents,
} from "../db/learning-agents";
import { createMemoryProposal } from "../db/memory-proposals";
import { createTurnAnnotation } from "../db/turn-annotations";
import { formatTurns, getTurnsAfterId } from "../db/turns";
import { buildLearningDataContext } from "../learning-data";
import type { ChatMessage } from "../providers/types";
import { generateDerivedConversation } from "./derive-conversation";
import { replaceCustomRuntimeAgents } from "./registry";
import type {
  ActionAgent,
  DerivationContext,
  Observer,
  PracticeContext,
  ReplyTransformer,
  ReplyTransformerInput,
  ReplyTransformerResult,
} from "./types";

const CustomObserverOutput = z.object({
  title: z.string().min(1),
  body_md: z.string().min(1),
  proposal_summary: z.string().optional(),
  memory_proposals: z.array(DataEditOperation).optional().default([]),
});

function parseStructured<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = schema.safeParse(parsed.value);
  if (!validated.success)
    throw new Error(
      `${label} output validation failed: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  return validated.data;
}

function customId(agent: LearningAgentMeta): string {
  return `custom:${agent.id}`;
}

function formatDataContext(dataContext: string): string {
  return dataContext.trim() || "(no learning data granted)";
}

async function runCustomObserver(
  agent: LearningAgentMeta,
  ctx: PracticeContext,
): Promise<void> {
  let turnId: string;
  try {
    turnId = await ctx.turnPersisted;
  } catch {
    return;
  }

  const dataContext = await buildLearningDataContext(agent, loadConfig());
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a custom observer agent in a language-learning app.

Your job is to inspect the learner's current message and produce a short visible note for the Coach Panel.
Follow the user's custom agent instructions exactly, but stay inside the output schema.

Rules:
- Return JSON only.
- Do not claim you changed learning memory directly.
- If you suggest memory writes, put them in memory_proposals using only
  create/update/delete/merge operations. For merge, key is the duplicate/source
  key and target_key is the canonical/target key.
- Use the learner's native language for explanations unless the custom instructions say otherwise.

=== CUSTOM AGENT INSTRUCTIONS ===
${agent.prompt}`,
    },
    {
      role: "user",
      content: `=== LANGUAGES ===
Native: ${ctx.langs.nativeLanguage}
Target: ${ctx.langs.targetLanguage}
Level: ${ctx.langs.level}

=== LEARNING DATA YOU MAY READ ===
${formatDataContext(dataContext)}

=== RECENT CONVERSATION ===
${ctx.tutorHistory || "(none)"}

=== CURRENT USER MESSAGE ===
${ctx.userInput}`,
    },
  ];

  const raw = await ctx.provider.generate({
    messages,
    temperature: 0.2,
    maxTokens: 2048,
    jsonSchema: toJsonSchema("CustomObserverOutput", CustomObserverOutput),
    meta: { label: agent.id },
  });
  const output = parseStructured(raw, CustomObserverOutput, agent.name);
  await createTurnAnnotation({
    turnId,
    agentId: customId(agent),
    title: output.title,
    bodyMd: output.body_md,
    payload: output,
  });
  const proposals = (output.memory_proposals ?? []) as DataEditOperation[];
  if (
    agent.writebackPolicy === "propose_review_signals" &&
    proposals.length > 0
  ) {
    await createMemoryProposal({
      agentId: customId(agent),
      turnId,
      summary: output.proposal_summary ?? output.title,
      operations: proposals,
    });
  }
}

async function runCustomAction(
  agent: LearningAgentMeta,
  ctx: DerivationContext,
): Promise<NewConversationContext> {
  const provider = await getProvider();
  if (!provider)
    throw new Error(
      "No API key configured, please fill it in on the settings page",
    );

  const config = loadConfig();
  const [conversation, turns, dataContext] = await Promise.all([
    getConversation(ctx.sourceConversationId),
    getTurnsAfterId(ctx.sourceConversationId, null),
    buildLearningDataContext(agent, config),
  ]);
  const title = conversation?.title?.trim() || "conversation";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a custom action agent in a language-learning app.

Your job is to turn the user's button click into a NEW conversation context.
The app has already opened a pending new conversation page. After your output,
the normal conversation partner will use your context to start the new conversation.

Rules:
- Return JSON only.
- Do not ask for confirmation.
- Do not continue the old chat directly; design the hidden context for a fresh conversation.
- Keep the opening_instruction concrete and executable by the conversation agent.
- Do not request changes to model keys, provider settings, or hidden counters.

=== CUSTOM ACTION INSTRUCTIONS ===
${agent.prompt}`,
    },
    {
      role: "user",
      content: `=== LANGUAGES ===
Native: ${config.nativeLanguage}
Target: ${config.targetLanguage}
Level: ${config.level}

=== LEARNING DATA YOU MAY READ ===
${formatDataContext(dataContext)}

=== SOURCE CONVERSATION TITLE ===
${title}

=== SOURCE CONVERSATION ===
${formatTurns(turns) || "(empty conversation)"}`,
    },
  ];

  return generateDerivedConversation(provider, messages, {
    temperature: 0.2,
    maxTokens: 1024,
    label: agent.id,
  });
}

function observerFromAgent(agent: LearningAgentMeta): Observer {
  return {
    id: customId(agent),
    kind: "observer",
    card: {
      title: agent.name,
      description: agent.description,
      entry: "auto_turn",
      timing: "After every practice turn · custom observer",
      reads: "Current input · recent conversation · authorized learning data",
      writes:
        agent.writebackPolicy === "propose_review_signals"
          ? "Can propose learning data write-backs (requires user confirmation)"
          : "Writes this turn's annotation only",
      canDisable: true,
    },
    run: (ctx) => runCustomObserver(agent, ctx),
  };
}

// Strip a ``` code fence the model occasionally wraps Markdown output in.
function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1].trim() : t;
}

// Reply transformer: runs on a specific AI reply (button / auto-run). panel/replace return Markdown for the chat to render;
// coach writes a turn annotation; memory proposes learning-data writes (reusing the observer schema + writeback path).
async function runCustomReplyTransformer(
  agent: LearningAgentMeta,
  input: ReplyTransformerInput,
): Promise<ReplyTransformerResult> {
  const provider = await getProvider();
  if (!provider)
    throw new Error(
      "No API key configured, please fill it in on the settings page",
    );

  const config = loadConfig();
  const dataContext = await buildLearningDataContext(agent, config);
  // The transformer runs either on the AI reply or on the learner's own message, depending on its stage.
  const onUserMessage = agent.transformerStage === "user_message";
  const subject = onUserMessage
    ? "the learner's own message (their attempt in the target language)"
    : "the AI reply";
  const sourceHeader = onUserMessage ? "THE LEARNER'S MESSAGE" : "AI REPLY";
  const userContent = `=== LANGUAGES ===
Native: ${config.nativeLanguage}
Target: ${config.targetLanguage}
Level: ${config.level}

=== LEARNING DATA YOU MAY READ ===
${formatDataContext(dataContext)}

=== ${sourceHeader} ===
${input.text}`;

  if (agent.outputMode === "memory") {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a custom reply-transformer in a language-learning app. Inspect ${subject} below and, following the user's instructions, propose learning-memory updates.

Rules:
- Return JSON only.
- Do not claim you changed learning memory directly. Put writes in memory_proposals using only
  create/update/delete/merge operations. For merge, key is the duplicate/source key and
  target_key is the canonical/target key.
- body_md is a short note in the learner's native language explaining what you propose.

=== CUSTOM AGENT INSTRUCTIONS ===
${agent.prompt}`,
      },
      { role: "user", content: userContent },
    ];
    const raw = await provider.generate({
      messages,
      temperature: 0.2,
      maxTokens: 2048,
      jsonSchema: toJsonSchema("CustomObserverOutput", CustomObserverOutput),
      meta: { label: agent.id },
    });
    const output = parseStructured(raw, CustomObserverOutput, agent.name);
    await createMemoryProposal({
      agentId: customId(agent),
      turnId: input.turnId,
      summary: output.proposal_summary ?? output.title,
      operations: (output.memory_proposals ?? []) as DataEditOperation[],
    });
    return {};
  }

  // panel / replace / coach: freeform Markdown.
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a custom reply-transformer in a language-learning app. The learner is working with ${subject} below. Apply the user's instructions to it and output the result as Markdown for the learner to read.

Output Markdown only — no preamble, no commentary, no code fences. Use the learner's native language (${config.nativeLanguage}) for explanations unless the instructions say otherwise.

=== CUSTOM AGENT INSTRUCTIONS ===
${agent.prompt}`,
    },
    { role: "user", content: userContent },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0.3,
    maxTokens: 2048,
    meta: { label: agent.id },
  });
  const markdown = stripFences(raw);
  if (!markdown)
    throw new Error("Reply transformer produced no output, please retry");

  if (agent.outputMode === "coach") {
    await createTurnAnnotation({
      turnId: input.turnId,
      agentId: customId(agent),
      title: agent.name,
      bodyMd: markdown,
    });
    return {};
  }
  return { markdown };
}

// Exported as a test seam (the routing-by-output-mode logic is the core new behavior); also used by reloadCustomRuntimeAgents.
export function replyTransformerFromAgent(
  agent: LearningAgentMeta,
): ReplyTransformer {
  const onUserMessage = agent.transformerStage === "user_message";
  const writes =
    agent.outputMode === "coach"
      ? "Writes a Coach-panel note on this turn"
      : agent.outputMode === "memory"
        ? "Proposes learning-data writes (requires your confirmation)"
        : onUserMessage
          ? "Shows a transformed view of your message (not saved)"
          : "Shows a transformed view of the reply (not saved)";
  const target = onUserMessage ? "message" : "reply";
  return {
    id: customId(agent),
    kind: "transformer",
    icon: agent.icon,
    outputMode: agent.outputMode,
    autoRun: agent.autoRun === 1,
    stage: agent.transformerStage,
    card: {
      title: agent.name,
      description: agent.description,
      entry: onUserMessage ? "message_action" : "reply_action",
      timing: agent.autoRun
        ? `Auto-runs on each new ${target} · custom button`
        : `User clicks the button on a ${target}`,
      reads: onUserMessage
        ? "Your message · authorized learning data"
        : "This AI reply · authorized learning data",
      writes,
      canDisable: true,
    },
    run: (input) => runCustomReplyTransformer(agent, input),
  };
}

function actionFromAgent(agent: LearningAgentMeta): ActionAgent {
  return {
    id: customId(agent),
    kind: "action",
    scope: "session",
    label: agent.name,
    description: agent.description,
    branchKind: "custom_action",
    card: {
      title: agent.name,
      description: agent.description,
      entry: "derive",
      timing: "User clicks",
      reads: "Current conversation · authorized learning data",
      writes:
        "Derives a new conversation context and opens a new session (does not change counts / keys / settings)",
      canDisable: true,
    },
    deriveContext: (ctx) => runCustomAction(agent, ctx),
  };
}

export async function reloadCustomRuntimeAgents(): Promise<void> {
  const agents = await listRuntimeLearningAgents();
  replaceCustomRuntimeAgents({
    observers: agents
      .filter((a) => a.kind === "observer")
      .map(observerFromAgent),
    actions: agents.filter((a) => a.kind === "action").map(actionFromAgent),
    replyTransformers: agents
      .filter((a) => a.kind === "reply_transformer")
      .map(replyTransformerFromAgent),
  });
}
