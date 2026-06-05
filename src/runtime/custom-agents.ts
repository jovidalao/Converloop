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
      `${label} 输出校验失败: ${validated.error.issues
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
  if (!provider) throw new Error("未配置 API key,请到设置页填写");

  const config = loadConfig();
  const [conversation, turns, dataContext] = await Promise.all([
    getConversation(ctx.sourceConversationId),
    getTurnsAfterId(ctx.sourceConversationId, null),
    buildLearningDataContext(agent, config),
  ]);
  const title = conversation?.title?.trim() || "对话";
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
      timing: "每轮普通练习后 · 自定义观察",
      reads: "当前输入 · 近期对话 · 授权学习数据",
      writes:
        agent.writebackPolicy === "propose_review_signals"
          ? "可提出学习数据写入建议(需用户确认)"
          : "只写本轮 annotation",
      canDisable: true,
    },
    run: (ctx) => runCustomObserver(agent, ctx),
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
      timing: "用户点击",
      reads: "当前会话 · 授权学习数据",
      writes: "衍生一个新对话上下文并新建会话(不改计数 / 密钥 / 设置)",
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
  });
}
