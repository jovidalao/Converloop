import {
  analyzeLessonSessionWriteback,
  analyzeLessonWriteback,
  toLessonWritebackCandidate,
} from "../agents/lesson-writeback";
import { getProvider, loadConfig } from "../config";
import {
  getConversation,
  getConversationModelOverride,
  parseAgentModifiers,
} from "../db/conversations";
import {
  getLearningAgent,
  type LearningAgentMeta,
} from "../db/learning-agents";
import { getAllMastery, recordSignals } from "../db/mastery";
import {
  type MasteryType,
  normalizeKey,
  type Signal,
} from "../db/mastery-logic";
import { formatTurns, getTurn, getTurnsAfterId } from "../db/turns";
import { staticT } from "../i18n";
import { rankMasteryItemsForInput } from "../lib/mastery-relevance";
import type { ChatMessage } from "../providers/types";
import { MissingApiKeyError, resolveDrill, tailTurnsByChars } from "./shared";

export interface LessonMasteryPreviewSignal {
  key: string;
  label: string;
  type: string;
  example: string;
}

export interface LessonMasteryPreview {
  summary: string;
  signals: LessonMasteryPreviewSignal[];
}

function lessonPreviewToSignals(
  preview: LessonMasteryPreview,
  agent: LearningAgentMeta,
): Signal[] {
  return preview.signals.map((signal) => ({
    key: signal.key,
    label: signal.label,
    type: signal.type as MasteryType,
    kind: "correct",
    example: signal.example,
    payload: {
      lesson_writeback: {
        lessonAgentId: agent.id,
        lessonName: agent.name,
        summary: preview.summary,
      },
    },
  }));
}

export async function previewLearningTurnMastery(
  conversationId: string,
  turnId: string,
): Promise<LessonMasteryPreview> {
  const conversation = await getConversation(conversationId);
  if (conversation?.kind !== "learning_agent") {
    throw new Error(staticT("errors.lessonOnly"));
  }
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const agentId = conversation.learningAgentId;
  if (!agentId) throw new Error(staticT("errors.lessonNoAgent"));
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error(staticT("errors.agentNotFound"));
  const turn = await getTurn(turnId);
  if (!turn || turn.conversationId !== conversationId) {
    throw new Error(staticT("errors.lessonTurnNotFound"));
  }
  if (!turn.userInput.trim()) {
    return {
      summary: staticT("errors.lessonNotLearnerOutput"),
      signals: [],
    };
  }

  const config = loadConfig();
  const [allItems, lessonTurns] = await Promise.all([
    getAllMastery(),
    getTurnsAfterId(conversationId, null),
  ]);
  const candidates = rankMasteryItemsForInput(
    allItems.filter((item) => item.status !== "known"),
    turn.userInput,
    turn.reply,
  )
    .slice(0, 40)
    .map(toLessonWritebackCandidate);
  if (candidates.length === 0) {
    return { summary: staticT("errors.lessonNoWriteback"), signals: [] };
  }
  const idx = lessonTurns.findIndex((item) => item.id === turnId);
  const history = formatTurns(
    idx >= 0
      ? lessonTurns.slice(Math.max(0, idx - 6), idx)
      : lessonTurns.slice(-6),
  );
  const result = await analyzeLessonWriteback(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
    lessonName: agent.name,
    candidates,
    history,
    userInput: turn.userInput,
    partnerReply: turn.reply,
  });
  const byKey = new Map(
    candidates.map((item) => [normalizeKey(item.key), item]),
  );
  const signals = result.signals.flatMap((signal) => {
    const item = byKey.get(normalizeKey(signal.key));
    if (!item) return [];
    return [
      {
        key: item.key,
        label: item.label,
        type: item.type,
        example: signal.evidence?.trim() || turn.userInput,
      },
    ];
  });
  return { summary: result.summary, signals };
}

export async function applyLearningTurnMasteryPreview(
  conversationId: string,
  turnId: string,
  preview: LessonMasteryPreview,
): Promise<{ summary: string; applied: number }> {
  const conversation = await getConversation(conversationId);
  if (conversation?.kind !== "learning_agent") {
    throw new Error(staticT("errors.lessonOnly"));
  }
  const agentId = conversation.learningAgentId;
  if (!agentId) throw new Error(staticT("errors.lessonNoAgent"));
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error(staticT("errors.agentNotFound"));
  const turn = await getTurn(turnId);
  if (!turn || turn.conversationId !== conversationId) {
    throw new Error(staticT("errors.lessonTurnNotFound"));
  }
  const signals = lessonPreviewToSignals(preview, agent);
  if (signals.length > 0) {
    await recordSignals(signals, turnId, "review");
  }
  return { summary: preview.summary, applied: signals.length };
}

export async function confirmLearningTurnMastery(
  conversationId: string,
  turnId: string,
): Promise<{ summary: string; applied: number }> {
  const preview = await previewLearningTurnMastery(conversationId, turnId);
  return applyLearningTurnMasteryPreview(conversationId, turnId, preview);
}

// Character budget for the session-review transcript: enough for a long lesson, bounded so one marathon session
// doesn't blow the context. Truncated from the most recent turns down.
const LESSON_SESSION_TRANSCRIPT_CHARS = 24000;

// End-of-session drill report (# Report section): one bounded pass over the session transcript
// following the drill author's report instructions. Read-only — it returns Markdown for display and
// never touches mastery or memory (an # Observer with proposals is the only write path, and even
// that requires user confirmation).
export async function generateDrillSessionReport(
  conversationId: string,
): Promise<string> {
  const conversation = await getConversation(conversationId);
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();
  const drill = await resolveDrill(
    parseAgentModifiers(conversation?.agentModifiersJson ?? null),
  );
  const reportInstructions = drill?.def.report?.trim();
  if (!drill || !reportInstructions) {
    throw new Error("This conversation's training mode has no report section");
  }
  const config = loadConfig();
  const turns = tailTurnsByChars(
    await getTurnsAfterId(conversationId, null),
    LESSON_SESSION_TRANSCRIPT_CHARS,
  );
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You write the end-of-session report for a training mode ("${drill.def.name}") in a language-learning app.
Follow the training mode's report instructions below over the session transcript. Ground every claim in the transcript — do not invent practice that is not there. Return clean Markdown only (no preamble), in the learner's native language unless the instructions say otherwise.

=== REPORT INSTRUCTIONS ===
${reportInstructions}`,
    },
    {
      role: "user",
      content: `=== LANGUAGES ===
Native: ${config.nativeLanguage}
Target: ${config.targetLanguage}
Level: ${config.level}

=== SESSION TRANSCRIPT ===
${formatTurns(turns) || "(empty session)"}`,
    },
  ];
  return provider.generate({
    messages,
    temperature: 0.3,
    maxTokens: 2048,
    meta: { label: `drill:${drill.modeId}:report` },
  });
}

// Whole-session mastery review for a focused lesson: one bounded observer pass over the full transcript proposing
// batch "correct" evidence for the non-known items the lesson touched. The learner confirms before anything is
// written (same LessonMasteryPreview shape as the per-turn button); recordSignals does the bookkeeping.
export async function previewLessonSessionMastery(
  conversationId: string,
): Promise<LessonMasteryPreview> {
  const conversation = await getConversation(conversationId);
  if (conversation?.kind !== "learning_agent") {
    throw new Error(staticT("errors.lessonOnly"));
  }
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const agentId = conversation.learningAgentId;
  if (!agentId) throw new Error(staticT("errors.lessonNoAgent"));
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error(staticT("errors.agentNotFound"));

  const config = loadConfig();
  const [allItems, lessonTurns] = await Promise.all([
    getAllMastery(),
    getTurnsAfterId(conversationId, null),
  ]);
  const learnerTurns = lessonTurns.filter((t) => t.userInput.trim());
  if (learnerTurns.length === 0) {
    return { summary: staticT("errors.lessonNotLearnerOutput"), signals: [] };
  }
  const learnerText = learnerTurns.map((t) => t.userInput).join("\n");
  const teacherText = lessonTurns.map((t) => t.reply).join("\n");
  const candidates = rankMasteryItemsForInput(
    allItems.filter((item) => item.status !== "known"),
    learnerText,
    teacherText,
  )
    .slice(0, 40)
    .map(toLessonWritebackCandidate);
  if (candidates.length === 0) {
    return { summary: staticT("errors.lessonNoWriteback"), signals: [] };
  }
  const transcript = formatTurns(
    tailTurnsByChars(lessonTurns, LESSON_SESSION_TRANSCRIPT_CHARS),
  );
  const result = await analyzeLessonSessionWriteback(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
    lessonName: agent.name,
    candidates,
    transcript,
  });
  const byKey = new Map(
    candidates.map((item) => [normalizeKey(item.key), item]),
  );
  const signals = result.signals.flatMap((signal) => {
    const item = byKey.get(normalizeKey(signal.key));
    if (!item) return [];
    return [
      {
        key: item.key,
        label: item.label,
        type: item.type,
        example: signal.evidence?.trim() || item.example || item.label,
      },
    ];
  });
  return { summary: result.summary, signals };
}

export async function applyLessonSessionMasteryPreview(
  conversationId: string,
  preview: LessonMasteryPreview,
): Promise<{ summary: string; applied: number }> {
  const conversation = await getConversation(conversationId);
  if (conversation?.kind !== "learning_agent") {
    throw new Error(staticT("errors.lessonOnly"));
  }
  const agentId = conversation.learningAgentId;
  if (!agentId) throw new Error(staticT("errors.lessonNoAgent"));
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error(staticT("errors.agentNotFound"));
  const signals = lessonPreviewToSignals(preview, agent);
  if (signals.length > 0) {
    await recordSignals(signals, undefined, "review");
  }
  return { summary: preview.summary, applied: signals.length };
}
