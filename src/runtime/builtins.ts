// Built-in agents (Phase 1): wrap existing converse / runLearningAgent / tutor as Runtime agents
// and self-register when this module is evaluated. Behavior is the same as before migration, just
// the caller changed from orchestrator to Runtime.
// Registration triggered by the side-effect import from ./index.

import { converse } from "../agents/conversation";
import { appendUserInstructions } from "../agents/custom-instructions";
import { runLearningAgent } from "../agents/learning";
import { generateLearningAgentDraft } from "../agents/learning-agent-builder";
import { analyze } from "../agents/tutor";
import { getProvider, loadConfig } from "../config";
import {
  type AgentModifiers,
  type BranchKind,
  createConversation,
  formatModifierInstructions,
  getConversation,
  type NewConversationContext,
} from "../db/conversations";
import { createLearningAgent } from "../db/learning-agents";
import { recordAnalysis, recordDictationAnalysis } from "../db/mastery";
import { formatTurns, getTurnsAfterId, updateTurnAnalysis } from "../db/turns";
import { renderDrillInstructions } from "../drills/render";
import { logError } from "../lib/log";
import { maybeRunMaintainer } from "../profile/maintainer-runner";
import { getBuiltinAgentOverride } from "./builtin-overrides";
import { generateDerivedConversation } from "./derive-conversation";
import { runDrillObserver } from "./drill-observer";
import {
  registerAction,
  registerObserver,
  registerReplyProducer,
  registerTransformer,
} from "./registry";
import type {
  ActionAgent,
  DerivationContext,
  LearningContext,
  Observer,
  PracticeContext,
  ReplyProducer,
  TransformerInfo,
} from "./types";

async function deriveConversationContext(
  ctx: DerivationContext,
  action: {
    label: string;
    objective: string;
  },
): Promise<NewConversationContext> {
  const provider = await getProvider();
  if (!provider)
    throw new Error(
      "No API key configured, please fill it in on the settings page",
    );
  const config = loadConfig();
  const [sourceConversation, turns] = await Promise.all([
    getConversation(ctx.sourceConversationId),
    getTurnsAfterId(ctx.sourceConversationId, null),
  ]);
  const sourceTitle =
    sourceConversation?.title?.trim() || "current conversation";
  const selectedTurn = ctx.sourceTurnId
    ? turns.find((t) => t.id === ctx.sourceTurnId)
    : null;
  const selectedBlock = selectedTurn
    ? `\n=== SELECTED SOURCE TURN ===\nUser: ${selectedTurn.userInput}\nPartner: ${selectedTurn.reply}\n`
    : "";
  const messages = [
    {
      role: "system" as const,
      content: `You are a Conversation Derivation Agent for a language-learning app.

Your job is to read an existing conversation and create a NEW conversation context.
The app has already pushed the user into the new conversation page. After your output,
the normal conversation partner will use your context to open the new conversation.

Rules:
- Return JSON only.
- Do not continue the old chat directly; design the hidden context for a fresh conversation.
- Preserve useful persona, scenario, and continuity from the source conversation when relevant.
- Keep the new context practical for spoken/written language practice.
- Do not ask to change model keys, provider settings, hidden counters, or raw database state.
- The opening_instruction should tell the conversation partner how to start naturally.
- Use concise fields; the user should feel the new conversation starts immediately, not as a report.`,
    },
    {
      role: "user" as const,
      content: `=== ACTION ===
${action.label}

=== ACTION OBJECTIVE ===
${action.objective}

=== LANGUAGES ===
Native: ${config.nativeLanguage}
Target: ${config.targetLanguage}
Level: ${config.level}

=== SOURCE CONVERSATION TITLE ===
${sourceTitle}
${selectedBlock}
=== SOURCE CONVERSATION ===
${formatTurns(turns) || "(empty conversation)"}`,
    },
  ];
  return generateDerivedConversation(provider, messages, {
    temperature: 0.3,
    maxTokens: 1400,
    label: `conversation_derivation:${action.label}`,
  });
}

// Main reply for normal practice conversation. Reads MD slice + review candidates + calibration, streams instantly.
const conversationReply: ReplyProducer = {
  id: "builtin:conversation",
  kind: "reply_producer",
  conversationKind: "practice",
  card: {
    title: "Conversation Partner",
    description:
      "Replies naturally in the target language, continuing the conversation — correction is the tutor's job.",
    entry: "auto_turn",
    timing: "Every turn · hot path · streaming",
    reads:
      "MD profile slice · mastered scaffolds · review candidates · difficulty calibration · session adjustments",
    writes: "None (reply text only)",
    canDisable: false,
  },
  run: (ctx, onDelta) => {
    const c = ctx as PracticeContext;
    // Say-drill live extra: how often the learner replayed the last sentence (difficulty signal).
    const replayNote =
      c.sayDrillReplayCount && c.sayDrillReplayCount > 0
        ? `PACING — the learner needed ${c.sayDrillReplayCount} replay(s) of the previous sentence (slow replays included): make the NEXT sentence a touch easier or shorter. If they answer without replays, you can stretch again.`
        : undefined;
    // "Say it again": the latest message re-produces the learner's corrected previous sentence from memory — without
    // this note the agent reads it as a puzzling near-duplicate and may comment on the repetition.
    const redoNote = c.redoTurn
      ? "REDO ATTEMPT — the learner is re-saying their previous sentence from memory, using the correction they just received. Acknowledge the improved attempt in a brief, natural way and carry the conversation forward; do NOT point out the repetition or treat it as a new topic."
      : undefined;
    // Drill conversations: render the per-turn instruction block from the drill document (the [[SAY]]
    // contract / item list / listening feed are appended by code in render.ts, never by the document).
    const drillBlock = c.drill
      ? renderDrillInstructions(c.drill.def, c.drill.params, {
          ...ctx.langs,
          listeningFocusWords: c.dictationFocusWords,
          replayNote,
        })
      : undefined;
    return converse(
      ctx.provider,
      {
        ...ctx.langs,
        experiencePreferences: c.conversationPreferences,
        profileSlice: c.profileSlice,
        comfortableItems: c.comfortableItems,
        reviewItems: c.reviewItems,
        calibrationHint: c.proficiency.calibrationHint,
        sessionAdjustments: formatModifierInstructions(c.agentModifiers, {
          drillBlock,
          redoNote,
        }),
        summary: ctx.summary,
        historyTurns: ctx.historyTurns,
        userInput: ctx.userInput,
        openingInstruction: ctx.openingInstruction,
        standaloneQuestion: ctx.standaloneQuestion,
        customInstructions: getBuiltinAgentOverride("builtin:conversation")
          ?.instructions,
        includeHintTrailer: c.includeHintTrailer,
      },
      onDelta,
      ctx.callbacks.onContext,
    );
  },
};

// Main reply for focused lessons. Teacher-style prompt + bounded data scope; tutor does not run.
const learningReply: ReplyProducer = {
  id: "builtin:learning",
  kind: "reply_producer",
  conversationKind: "learning_agent",
  card: {
    title: "Focused Lesson Teacher",
    description:
      "Runs a teacher-style focused lesson using the course prompt and bounded learning data.",
    entry: "lesson",
    timing: "Every focused-lesson turn · streaming",
    reads: "Authorized learning data scope · course prompt",
    writes: "None",
    canDisable: false,
  },
  run: (ctx, onDelta) => {
    const l = ctx as LearningContext;
    return runLearningAgent(
      ctx.provider,
      {
        ...ctx.langs,
        experiencePreferences: l.experiencePreferences,
        agentName: l.agentName,
        agentPrompt: l.agentPrompt,
        dataContext: l.dataContext,
        summary: ctx.summary,
        historyTurns: ctx.historyTurns,
        userInput: ctx.userInput,
        kickoff: l.kickoff,
        customInstructions:
          getBuiltinAgentOverride("builtin:learning")?.instructions,
      },
      onDelta,
      ctx.callbacks.onContext,
    );
  },
};

// Tutor observer: runs structured correction in parallel with the main reply; code bookkeeping runs after the turn is persisted.
// LLM only observes (emits discrete signals); counts are computed by recordAnalysis — no mastery numbers are changed here.
const tutorObserver: Observer = {
  id: "builtin:tutor",
  kind: "observer",
  providesTurnAnalysis: true,
  card: {
    title: "Correction Tutor",
    description:
      "Corrects in parallel per sentence — errors, natural alternatives, expression gaps — signals fed to code bookkeeping.",
    entry: "auto_turn",
    timing: "Every turn · hot path · parallel with reply",
    reads: "SQLite weakness table · current input",
    writes:
      "error/correct/introduced/gap signals → code bookkeeping (LLM does not touch counts)",
    canDisable: true,
  },
  run: async (ctx: PracticeContext) => {
    // Drills can opt out of correction entirely (grading: none).
    if (ctx.drill?.def.grading === "none") {
      ctx.callbacks.onAnalysis(null);
      return;
    }
    const { analysis, proseFeedback, diagnostic, error } = await analyze(
      ctx.provider,
      {
        ...ctx.langs,
        experiencePreferences: ctx.tutorPreferences,
        ignoreCapitalizationIssues: ctx.tutorFlags.ignoreCapitalizationIssues,
        ignorePunctuationIssues: ctx.tutorFlags.ignorePunctuationIssues,
        weakList: ctx.weakList,
        keyHints: ctx.keyHints,
        history: ctx.tutorHistory,
        previousPartnerReply: ctx.previousPartnerReply,
        userInput: ctx.userInput,
        standardAnswer: ctx.dictationStandardAnswer,
        customInstructions:
          getBuiltinAgentOverride("builtin:tutor")?.instructions,
      },
    );

    // Wait for the current turn row to be persisted before writing back; if persistence fails (reply errored) abandon bookkeeping, same as before migration.
    let turnId: string;
    try {
      turnId = await ctx.turnPersisted;
    } catch {
      return;
    }

    if (analysis) {
      ctx.callbacks.onAnalysis(analysis);
      try {
        // Mastery routing follows the drill's mastery enum (code bookkeeping; the LLM never touches counts):
        //   production → normal ledger;  review → same ledger tagged source="review" (targeted retrieval);
        //   listening → isolated "listening:<word>" dimension (mishearings must not pollute the weak list);
        //   none → record nothing.
        const mastery = ctx.drill?.def.mastery ?? "production";
        if (mastery === "production" || mastery === "review") {
          await recordAnalysis(
            analysis,
            turnId,
            mastery === "review" ? "review" : "tutor",
          );
        } else if (mastery === "listening" && ctx.dictationStandardAnswer) {
          await recordDictationAnalysis(
            analysis,
            ctx.dictationStandardAnswer,
            turnId,
            ctx.langs.targetLanguage,
          );
        }
        await updateTurnAnalysis(turnId, analysis);
        if (!ctx.dictationStandardAnswer) void maybeRunMaintainer();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError("turn", "Correction bookkeeping failed", e);
        ctx.callbacks.onAnalysis(analysis, {
          error: `Correction shown but save failed: ${msg}`,
        });
      }
    } else if (proseFeedback) {
      try {
        await updateTurnAnalysis(turnId, null, proseFeedback, diagnostic);
      } catch (e) {
        logError("turn", "Plain-text correction save failed", e);
      }
      ctx.callbacks.onAnalysis(null, { proseFeedback, error, diagnostic });
    } else if (error) {
      ctx.callbacks.onAnalysis(null, { error, diagnostic });
    }
  },
};

// Drill observer host: one registered observer that runs the # Observer section of whichever drill
// the current conversation belongs to (no-op for non-drill turns and drills without the section).
// Annotations land on the turn under drill:<modeId>:observer; memory writes are proposal-only.
const drillObserverHost: Observer = {
  id: "builtin:drill_observer",
  kind: "observer",
  card: {
    title: "Drill observer",
    description:
      "Runs a training mode's own # Observer instructions after each answer in that drill — extra notes in the coach panel.",
    entry: "auto_turn",
    timing:
      "Every drill turn · parallel with the reply (only for drills with an # Observer section)",
    reads:
      "Current answer · recent drill turns · the scopes the drill declares",
    writes:
      "Turn annotations; memory writes are proposals only (require user confirmation)",
    canDisable: true,
  },
  run: async (ctx: PracticeContext) => {
    const drill = ctx.drill;
    const instructions = drill?.def.observer?.trim();
    if (!drill || !instructions) return;
    await runDrillObserver(ctx, drill, instructions);
  },
};

registerReplyProducer(conversationReply);
registerReplyProducer(learningReply);
registerObserver(tutorObserver);
registerObserver(drillObserverHost);

const transformers: TransformerInfo[] = [
  {
    id: "builtin:transformer:explain",
    card: {
      title: "Reply Explanation",
      description:
        "Explains on demand in native language the structures, idioms, and usage that might trip up the learner.",
      entry: "reply_action",
      timing: "User clicks Explain",
      reads: "Current reply · MD profile slice · reading preferences",
      writes: "None (explanation text only)",
      canDisable: false,
    },
  },
  {
    id: "builtin:transformer:bilingual",
    card: {
      title: "Bilingual Reading",
      description:
        "Rearranges a reply into interleaved target-language / native-language sentences for easier reading.",
      entry: "reply_action",
      timing: "User clicks Bilingual",
      reads: "Current reply · reading preferences",
      writes: "None (bilingual Markdown only)",
      canDisable: false,
    },
  },
  {
    id: "builtin:transformer:translate",
    card: {
      title: "Word/Phrase Lookup",
      description: "Explains selected words, phrases, or sentences in context.",
      entry: "selection",
      timing: "User selects text",
      reads: "Selected text · surrounding context · reading preferences",
      writes: "None (analysis text only)",
      canDisable: false,
    },
  },
];

for (const transformer of transformers) registerTransformer(transformer);

// Conversation derivation agents: clicking first creates a pending new conversation; the new page then runs deriveContext to generate context and open the conversation.
// The original conversation is always untouched (non-destructive), unlike "start from here" (which truncates).
interface DerivationSpec {
  id: string;
  scope: ActionAgent["scope"];
  label: string;
  description: string;
  kind: BranchKind;
  objective: string;
  modifiers?: AgentModifiers;
}

function makeDerivationAction(spec: DerivationSpec): ActionAgent {
  return {
    id: spec.id,
    kind: "action",
    scope: spec.scope,
    label: spec.label,
    description: spec.description,
    branchKind: spec.kind,
    baseModifiers: spec.modifiers,
    card: {
      title: spec.label,
      description: spec.description,
      entry: "derive",
      timing: "User clicks",
      reads:
        spec.scope === "turn"
          ? "Current conversation + selected turn"
          : "Current conversation",
      writes:
        "Derives a new conversation context and opens a new session (does not change counts / keys / settings)",
      canDisable: true,
    },
    // Name override + append supplementary instructions after the official objective (does not replace the base prompt); read at click time.
    deriveContext: (ctx) => {
      const ov = getBuiltinAgentOverride(spec.id);
      return deriveConversationContext(ctx, {
        label: ov?.label ?? spec.label,
        objective: appendUserInstructions(spec.objective, ov?.instructions),
      });
    },
  };
}

const derivationSpecs: DerivationSpec[] = [
  {
    id: "builtin:action:branch_from",
    scope: "turn",
    label: "Branch from here",
    description:
      "Open a new conversation continuing from the context before this turn.",
    kind: "branch_from",
    objective:
      "Create a fresh continuation based on the selected source turn. Preserve the useful setup before that point, but start the new conversation cleanly without copying visible history.",
  },
  {
    id: "builtin:action:restart",
    scope: "session",
    label: "Restart",
    description:
      "Keep the core setup; open a blank new conversation for re-practice.",
    kind: "restart",
    objective:
      "Restart the same useful scenario/persona from a clean beginning. Keep the learning purpose, but do not continue as if previous turns already happened.",
  },
  {
    id: "builtin:action:harder",
    scope: "session",
    label: "Increase difficulty",
    description: "Generate a harder version of the same practice.",
    kind: "harder",
    modifiers: { difficultyDelta: 1 },
    objective:
      "Create a harder version of the current practice. Keep the scenario and continuity that matter, but make the target-language demands richer, more idiomatic, and more challenging.",
  },
  {
    id: "builtin:action:easier",
    scope: "session",
    label: "Decrease difficulty",
    description: "Generate an easier version of the same practice.",
    kind: "easier",
    modifiers: { difficultyDelta: -1 },
    objective:
      "Create an easier version of the current practice. Keep the useful scenario, but lower the difficulty: shorter sentences, common words, clearer prompts, and one idea at a time.",
  },
  {
    id: "builtin:action:swap_roles",
    scope: "session",
    label: "Swap roles",
    description: "Generate a role-reversed version of the conversation.",
    kind: "swap_roles",
    modifiers: { swapRoles: true },
    objective:
      "Create a role-swapped version of the current conversation. The learner should lead more of the exchange; the AI should take the counterpart role and respond naturally.",
  },
  {
    id: "builtin:action:next_day",
    scope: "session",
    label: "Continue next day",
    description: "Generate a new-day continuation following the current story.",
    kind: "next_day",
    modifiers: { nextDay: true },
    objective:
      "Create a new-day continuation. Use relevant continuity from the source conversation, but start on the next day with a natural reconnection and a fresh opening.",
  },
  {
    id: "builtin:action:change_scene",
    scope: "session",
    label: "Change scene",
    description: "Keep the practice goal; switch to a more fitting scene.",
    kind: "change_scene",
    objective:
      "Create a new scenario that practices the same useful language goals from the current conversation, but changes the setting so the learner can transfer the skill.",
  },
];

const LESSON_FROM_CONVERSATION_ID = "builtin:action:lesson_from_conversation";
const LESSON_FROM_CONVERSATION_DEFAULTS = {
  label: "Turn into focused lesson",
  description:
    "Extract the issues and goals from this chat into a reusable focused lesson.",
  objective:
    "Create a focused lesson agent from this conversation. Identify the most useful practice theme, recurring mistakes, and next drill. Keep it practical and interactive.",
};

const lessonFromConversation: ActionAgent = {
  id: LESSON_FROM_CONVERSATION_ID,
  kind: "action",
  scope: "session",
  label: LESSON_FROM_CONVERSATION_DEFAULTS.label,
  description:
    "Generate a focused lesson from this conversation and open a new lesson session.",
  card: {
    title: LESSON_FROM_CONVERSATION_DEFAULTS.label,
    description: LESSON_FROM_CONVERSATION_DEFAULTS.description,
    entry: "derive",
    timing: "User clicks",
    reads: "Current conversation history · language config",
    writes: "Creates a focused-lesson agent + a focused-lesson session",
    canDisable: true,
  },
  run: async (ctx) => {
    const provider = await getProvider();
    if (!provider)
      throw new Error(
        "No API key configured, please fill it in on the settings page",
      );
    const config = loadConfig();
    const turns = await getTurnsAfterId(ctx.conversationId, null);
    const history = formatTurns(turns);
    const instruction = appendUserInstructions(
      LESSON_FROM_CONVERSATION_DEFAULTS.objective,
      getBuiltinAgentOverride(LESSON_FROM_CONVERSATION_ID)?.instructions,
    );
    const draft = await generateLearningAgentDraft(
      provider,
      `${instruction}\n\n=== CONVERSATION ===\n${history || "(empty)"}`,
      {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        level: config.level,
      },
    );
    const agentId = await createLearningAgent(draft);
    const conversationId = await createConversation(draft.name, undefined, {
      kind: "learning_agent",
      learningAgentId: agentId,
    });
    return { navigateTo: conversationId };
  },
};

const branchActions: ActionAgent[] = [
  ...derivationSpecs.map(makeDerivationAction),
  lessonFromConversation,
];

for (const action of branchActions) registerAction(action);

// Editable built-in conversation derivation actions in the agent library: default label/description/objective for UI pre-fill and "restore defaults".
// objective is the prompt fed to the derivation agent (for lesson creation it is the instruction to generate the lesson draft).
export interface BuiltinActionDefault {
  label: string;
  description: string;
  objective: string;
}

export const BUILTIN_ACTION_DEFAULTS: Record<string, BuiltinActionDefault> = {
  ...Object.fromEntries(
    derivationSpecs.map((spec) => [
      spec.id,
      {
        label: spec.label,
        description: spec.description,
        objective: spec.objective,
      },
    ]),
  ),
  [LESSON_FROM_CONVERSATION_ID]: LESSON_FROM_CONVERSATION_DEFAULTS,
};
