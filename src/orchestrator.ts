import { generateAutoTitle } from "./agents/auto-title";
import { bilingual } from "./agents/bilingual";
import { converse } from "./agents/conversation";
import { generateConversationTopics } from "./agents/conversation-topics";
import { explain } from "./agents/explain";
import { generateInputHints } from "./agents/input-hints";
import { generateLearningAgentDraft } from "./agents/learning-agent-builder";
import {
  analyzeLessonWriteback,
  toLessonWritebackCandidate,
} from "./agents/lesson-writeback";
import { classifyProfilePreferenceInstruction } from "./agents/profile-preferences";
import { generateQuickfireTopics } from "./agents/quickfire-topics";
import {
  type ReplySuggestionResult,
  type ReplySuggestionSource,
  suggestReplyText,
} from "./agents/reply-suggestion";
import type { TutorAnalysis } from "./agents/schema";
import {
  fallbackSelectionLearningItem,
  generateSelectionLearningItem,
} from "./agents/selection-learning-item";
import { planLearningProject } from "./agents/task-agent";
import { translate } from "./agents/translate";
import { type AppConfig, getProvider, loadConfig } from "./config";
import { applyDataEditInstruction, type DataEditResult } from "./data-edit";
import { runTrackedAgentJob } from "./db/agent-jobs";
import { getAppState, setAppState } from "./db/app-state";
import {
  completeDerivedConversation,
  DEFAULT_CONVERSATION_TITLE,
  DICTATION_OPENING_INSTRUCTION,
  failDerivedConversation,
  formatModifierInstructions,
  getConversation,
  getSummary,
  listConversations,
  parseAgentModifiers,
  parseDictationReply,
  QUICKFIRE_OPENING_INSTRUCTION,
  renameConversation,
} from "./db/conversations";
import { createLearningAgent, getLearningAgent } from "./db/learning-agents";
import { createLearningProject } from "./db/learning-projects";
import {
  createManualMasteryItem,
  getAllMastery,
  getComfortableList,
  getMasteryKeyHints,
  getReviewDueList,
  getWeakList,
  recordSignals,
} from "./db/mastery";
import { normalizeKey } from "./db/mastery-logic";
import { getProficiencySnapshot } from "./db/proficiency";
import {
  formatTurns,
  getTurn,
  getTurnsAfterId,
  persistTurn,
  toHistoryTurns,
  updateTurnReply,
} from "./db/turns";
import { buildLearningDataContext } from "./learning-data";
import { rankMasteryItemsForInput } from "./lib/mastery-relevance";
import { estimateTokens } from "./lib/tokens";
import {
  appendClassifiedPreferences,
  correctionPreferenceFlags,
  formatExperiencePreferences,
  preferencesFromProfile,
} from "./profile/preferences";
import { profileSliceForConversation, readProfile } from "./profile/profile";
import { maybeCompressConversation } from "./profile/summary-runner";
import {
  type ConversationCallbacks,
  derivePendingAction,
  dispatchObservers,
  dispatchReply,
  getBuiltinAgentOverride,
  HOOKS,
  type LearningContext,
  type PracticeContext,
  runTransformer,
} from "./runtime";

// Callback shape is defined centrally in runtime (ConversationCallbacks); this alias export preserves existing references.
export type TurnCallbacks = ConversationCallbacks;

export interface TurnResult {
  reply: string;
  analysis: TutorAnalysis | null;
}

// The tutor only needs enough context to disambiguate the latest utterance; supply this many recent turns. All verbatim turns after the watermark go to the conversation agent.
const TUTOR_HISTORY_TURNS = 8;
const SUGGESTION_CONTEXT_CHARS = 12000;

export class MissingApiKeyError extends Error {
  constructor() {
    super("No API key configured, please fill it in on the settings page");
    this.name = "MissingApiKeyError";
  }
}

// Off-record slash turn (/btw): answer one standalone question with no chat/lesson history,
// no review weaving, no correction, and no future context footprint.
async function runStandaloneSideQuestion(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const profileMd = await readProfile(config);
  const id = turnId ?? crypto.randomUUID();
  let resolvePersisted!: (value: string) => void;
  let rejectPersisted!: (reason: unknown) => void;
  const turnPersisted = new Promise<string>((resolve, reject) => {
    resolvePersisted = resolve;
    rejectPersisted = reject;
  });
  void turnPersisted.catch(() => {});

  const ctx: PracticeContext = {
    kind: "practice",
    provider,
    conversationId,
    turnId: id,
    userInput,
    langs: {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
    },
    profileSlice: "",
    conversationPreferences: formatExperiencePreferences(
      profileMd,
      "conversation",
    ),
    tutorPreferences: "",
    tutorFlags: {
      ignoreCapitalizationIssues: false,
      ignorePunctuationIssues: false,
    },
    summary: "",
    historyTurns: [],
    tutorHistory: "",
    weakList: [],
    keyHints: [],
    comfortableItems: [],
    reviewItems: [],
    proficiency: await getProficiencySnapshot(),
    agentModifiers: {},
    callbacks: cb,
    standaloneQuestion: true,
    turnPersisted,
  };

  const replyPromise = dispatchReply(ctx, cb.onReplyDelta);
  cb.onAnalysis(null);

  let reply: string;
  try {
    reply = await replyPromise;
  } catch (e) {
    rejectPersisted(e);
    throw e;
  }

  await persistTurn(conversationId, userInput, reply, null, id, {
    excludeFromContext: true,
  });
  resolvePersisted(id);
  cb.onReplyComplete?.(reply);
  return { reply, analysis: null };
}

function tailTurnsByChars<T extends { userInput: string; reply: string }>(
  turns: T[],
  charBudget: number,
): T[] {
  let used = 0;
  let start = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const next = turns[i];
    const cost = next.userInput.length + next.reply.length + 32;
    if (used + cost > charBudget && start < turns.length) break;
    used += cost;
    start = i;
  }
  return turns.slice(start);
}

// Shared per-turn data fetching for runTurn and startDerivedConversation: summary + global mastery table + profile,
// fetched once in parallel (all independent, avoids stacking latency). Per-caller rankMasteryItemsForInput
// (whose query/context differs between hot path and derived opening) is handled by each caller.
async function loadTurnContextData(conversationId: string, config: AppConfig) {
  const [
    summaryData,
    weakListRaw,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
    keyHints,
  ] = await Promise.all([
    getSummary(conversationId),
    getWeakList(),
    readProfile(config),
    getComfortableList(),
    getReviewDueList(),
    getProficiencySnapshot(),
    getMasteryKeyHints(),
  ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  return {
    summaryData,
    weakListRaw,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
    keyHints,
    verbatimTurns,
  };
}

// Token estimate for the "non-history dynamic block" used by the auto-compression watermark: profile slice + mastered scaffold + review candidates.
function estimateNonHistoryTokens(
  profileSlice: string,
  comfortableItems: {
    label: string;
    example?: string | null;
    notes?: string | null;
  }[],
  reviewItems: {
    label: string;
    example?: string | null;
    notes?: string | null;
  }[],
): number {
  const listText = (
    items: { label: string; example?: string | null; notes?: string | null }[],
  ) =>
    items
      .map((r) => `${r.label} ${r.example ?? ""} ${r.notes ?? ""}`)
      .join("\n");
  return (
    estimateTokens(profileSlice) +
    estimateTokens(listText(comfortableItems)) +
    estimateTokens(listText(reviewItems))
  );
}

export async function createCustomLearningAgentFromDescription(
  description: string,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const draft = await generateLearningAgentDraft(provider, description, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  });
  return createLearningAgent(draft);
}

export async function createLearningProjectFromGoal(
  description: string,
): Promise<{
  projectId: string;
  createdLearningAgentIds: string[];
  jobId: string;
}> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const ctx = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };
  const { jobId, result } = await runTrackedAgentJob(
    {
      kind: "learning_project_plan",
      source: "task_agent",
      input: { description, ...ctx },
    },
    async () => {
      const plan = await planLearningProject(provider, description, ctx);
      const projectId = await createLearningProject({
        title: plan.title,
        goal: plan.goal,
        planMd: plan.planMarkdown,
        notesMd: plan.notesMarkdown,
        sourcePrompt: description,
        taskPlan: plan.raw,
      });
      const createdLearningAgentIds: string[] = [];
      for (const lesson of plan.suggestedLessons) {
        createdLearningAgentIds.push(await createLearningAgent(lesson));
      }
      return {
        projectId,
        createdLearningAgentIds,
        title: plan.title,
        goal: plan.goal,
        nextActions: plan.nextActions,
      };
    },
  );

  return {
    projectId: result.projectId,
    createdLearningAgentIds: result.createdLearningAgentIds,
    jobId,
  };
}

export async function editLearningDataWithInstruction(
  instruction: string,
): Promise<DataEditResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  return applyDataEditInstruction(provider, instruction, loadConfig());
}

export async function confirmLearningTurnMastery(
  conversationId: string,
  turnId: string,
): Promise<{ summary: string; applied: number }> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const conversation = await getConversation(conversationId);
  if (conversation?.kind !== "learning_agent") {
    throw new Error(
      "Only focused-lesson sessions can confirm lesson mastery signals",
    );
  }
  const agentId = conversation.learningAgentId;
  if (!agentId)
    throw new Error("This focused lesson has no learning agent linked");
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error("Learning agent not found");
  const turn = await getTurn(turnId);
  if (!turn || turn.conversationId !== conversationId) {
    throw new Error("Focused-lesson turn not found");
  }
  if (!turn.userInput.trim()) {
    return {
      summary: "This turn is not learner output; nothing was written.",
      applied: 0,
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
    return { summary: "No learning items to write back.", applied: 0 };
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
        kind: "correct" as const,
        example: signal.evidence?.trim() || turn.userInput,
        payload: {
          lesson_writeback: {
            lessonAgentId: agent.id,
            lessonName: agent.name,
            summary: result.summary,
          },
        },
      },
    ];
  });
  if (signals.length > 0) {
    await recordSignals(signals, turnId, "review");
  }
  return { summary: result.summary, applied: signals.length };
}

export async function applyProfilePreferenceInstruction(
  instruction: string,
  currentProfileMd: string,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  const items = await classifyProfilePreferenceInstruction(
    provider,
    instruction,
    preferencesFromProfile(currentProfileMd),
  );
  return appendClassifiedPreferences(currentProfileMd, items);
}

export async function addSelectionToLearningData(
  selection: string,
  context: string,
): Promise<{ key: string; label: string; type: string }> {
  const config = loadConfig();
  const provider = await getProvider();
  const draft = provider
    ? await generateSelectionLearningItem(provider, {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        selection,
        context,
        existingKeys: (await getMasteryKeyHints(60)).map((h) => h.key),
      })
    : fallbackSelectionLearningItem(selection, context);
  await createManualMasteryItem(draft);
  return { key: draft.key, label: draft.label, type: draft.type };
}

// End-to-end single turn: conversation ∥ tutor in parallel → streaming reply immediately, correction arrives later → accounting + persistence.
// A tutor crash does not affect the conversation (graceful degradation: analysis=null, mastery not updated this turn).
export async function runTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
  opts: { offRecord?: boolean; displayText?: string } = {},
): Promise<TurnResult> {
  // Off-record turn (/btw "by the way"): standalone helper answer, no correction, not counted in future context, no compression.
  const offRecord = opts.offRecord ?? false;
  // Prompt-macro turn (/topic, /learn, /surprise): userInput is the expanded English prompt — fed to the agent as an
  // APP INSTRUCTION and kept in context, but not graded. The bubble shows opts.displayText (the verbatim command).
  const isPromptMacro = opts.displayText !== undefined;
  const conversation = await getConversation(conversationId);
  if (offRecord) {
    return runStandaloneSideQuestion(userInput, conversationId, cb, turnId);
  }
  if (conversation?.kind === "learning_agent") {
    return runLearningTurn(
      userInput,
      conversationId,
      cb,
      false,
      turnId,
      offRecord,
      opts.displayText,
    );
  }

  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };

  // Shared context (read by both agents), fetched upfront before being fed in. Independent of each other — fetched in parallel to avoid stacking latency and delaying the first token.
  // History is scoped to the current conversation (topics do not bleed); weakList / comfortableItems / reviewItems / proficiency come from the global mastery table.
  // Auto-compression: conversation context = rolling summary (older content) + all verbatim turns after the watermark. Falls back to pure verbatim when summary is NULL.
  const {
    summaryData,
    weakListRaw,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
    keyHints,
    verbatimTurns,
  } = await loadTurnContextData(conversationId, config);
  const history = formatTurns(verbatimTurns);
  // The conversation agent sees these recent turns as real alternating messages; the string `history` above is still used for mastery-relevance ranking and the tutor.
  const historyTurns = toHistoryTurns(verbatimTurns);
  // The tutor only needs the most recent turns; do not feed all verbatim turns after the watermark into the structured analysis (saves tokens, shortens input).
  const tutorHistory = formatTurns(verbatimTurns.slice(-TUTOR_HISTORY_TURNS));
  const weakList = rankMasteryItemsForInput(
    weakListRaw,
    userInput,
    tutorHistory,
  );
  const reviewItems = rankMasteryItemsForInput(
    reviewItemsRaw,
    userInput,
    history,
  );
  const comfortableItems = rankMasteryItemsForInput(
    comfortableItemsRaw,
    userInput,
    history,
  );
  const profileSlice = profileSliceForConversation(profileMd);
  const conversationPreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );
  const tutorPreferences = formatExperiencePreferences(profileMd, "tutor");
  const tutorFlags = correctionPreferenceFlags(profileMd);
  // Session-level modifiers (difficulty/role/next-day from branching); normal conversations get an empty object, which the reply agent naturally ignores.
  const agentModifiers = parseAgentModifiers(
    conversation?.agentModifiersJson ?? null,
  );
  // Dictation: the sentence being transcribed is the one the prior AI turn spoke (the last verbatim reply). Hand it to
  // the tutor as the standard answer so grading is a comparison, not free-form correction. Undefined for non-dictation
  // (or a missing prior turn), in which case the tutor grades as usual.
  const dictationStandardAnswer = agentModifiers.dictation
    ? parseDictationReply(verbatimTurns[verbatimTurns.length - 1]?.reply ?? "")
        .sentence || undefined
    : undefined;

  // Reuse the turnId generated during optimistic rendering on the frontend (if provided): gives the UI bubble and the persisted DB row the same id,
  // so "start from here" (truncate by id) and "regenerate" (locate by id) can target this turn even before a refresh.
  const id = turnId ?? crypto.randomUUID();
  // Both observers and logs are attached to this turn; observers wait for turnPersisted before writing back, to avoid writing to a row not yet in the DB.
  let resolvePersisted!: (value: string) => void;
  let rejectPersisted!: (reason: unknown) => void;
  const turnPersisted = new Promise<string>((resolve, reject) => {
    resolvePersisted = resolve;
    rejectPersisted = reject;
  });
  void turnPersisted.catch(() => {}); // observers also catch; this is a safety net to prevent unhandled rejection

  const ctx: PracticeContext = {
    kind: "practice",
    provider,
    conversationId,
    turnId: id,
    userInput,
    // Prompt macros steer the reply via the APP INSTRUCTION path (same as derived openings), so the agent treats the
    // expanded prompt as a directive rather than learner speech; userInput is still persisted for future context.
    openingInstruction: isPromptMacro ? userInput : undefined,
    langs,
    profileSlice,
    conversationPreferences,
    tutorPreferences,
    tutorFlags,
    summary: summaryData.summary ?? "",
    historyTurns,
    tutorHistory,
    weakList,
    keyHints,
    comfortableItems,
    reviewItems,
    proficiency,
    agentModifiers,
    dictationStandardAnswer,
    callbacks: cb,
    turnPersisted,
  };

  // Reply ∥ observer triggered in parallel. Observers are fire-and-forget; they wait for turnPersisted themselves before running accounting.
  // Off-record turns are not corrected: do not dispatch observers; instead tell the UI immediately that this turn has no correction (clears the "analyzing" state).
  const replyPromise = dispatchReply(ctx, cb.onReplyDelta);
  // Neither off-record nor prompt-macro turns are graded: the former is a side question, the latter an app directive.
  if (offRecord || isPromptMacro) cb.onAnalysis(null);
  else dispatchObservers(ctx);

  let reply: string;
  try {
    reply = await replyPromise;
  } catch (e) {
    rejectPersisted(e); // reply failed → turn is not persisted, observers abandon accounting (consistent with pre-migration behavior)
    throw e;
  }

  await persistTurn(conversationId, userInput, reply, null, id, {
    excludeFromContext: offRecord,
    displayText: opts.displayText,
  });
  resolvePersisted(id);
  cb.onReplyComplete?.(reply);

  // Auto-compression: when approaching the context limit, fold the oldest verbatim turns into the rolling summary in the background. Does not block the next turn's input.
  // Non-history dynamic block = profile + review list, added on top of the fixed reserve so the watermark reflects the actual load this turn.
  // Off-record turns do not enter context and therefore add no compression pressure; skip.
  if (!offRecord) {
    void maybeCompressConversation(
      conversationId,
      estimateNonHistoryTokens(profileSlice, comfortableItems, reviewItems),
    );
  }

  return { reply, analysis: null };
}

export async function startLearningSession(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  return runLearningTurn("", conversationId, cb, true, turnId);
}

// Open a conversation with a hidden app kickoff (the AI speaks first): loads the same per-turn context as a normal
// practice turn, runs the reply agent with the given opening instruction, persists the empty-user opening turn, and
// reports no correction. Shared by derived conversations and rapid-fire drills — the per-conversation behavior
// (derived context / quickfire scenario) is already in agent_modifiers_json and injected via SESSION ADJUSTMENTS.
async function openConversationWithInstruction(
  conversationId: string,
  openingInstruction: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };

  const [
    {
      summaryData,
      weakListRaw,
      profileMd,
      comfortableItemsRaw,
      reviewItemsRaw,
      proficiency,
      keyHints,
      verbatimTurns,
    },
    conv,
  ] = await Promise.all([
    loadTurnContextData(conversationId, config),
    getConversation(conversationId),
  ]);
  const history = formatTurns(verbatimTurns);
  const weakList = rankMasteryItemsForInput(
    weakListRaw,
    openingInstruction,
    history,
  );
  const reviewItems = rankMasteryItemsForInput(
    reviewItemsRaw,
    openingInstruction,
    history,
  );
  const comfortableItems = rankMasteryItemsForInput(
    comfortableItemsRaw,
    openingInstruction,
    history,
  );
  const profileSlice = profileSliceForConversation(profileMd);
  const conversationPreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );
  const id = turnId ?? crypto.randomUUID();
  const turnPersisted = Promise.resolve(id);

  const ctx: PracticeContext = {
    kind: "practice",
    provider,
    conversationId,
    turnId: id,
    userInput: "",
    openingInstruction,
    langs,
    profileSlice,
    conversationPreferences,
    tutorPreferences: "",
    tutorFlags: {
      ignoreCapitalizationIssues: false,
      ignorePunctuationIssues: false,
    },
    summary: summaryData.summary ?? "",
    historyTurns: toHistoryTurns(verbatimTurns),
    tutorHistory: "",
    weakList,
    keyHints,
    comfortableItems,
    reviewItems,
    proficiency,
    agentModifiers: parseAgentModifiers(conv?.agentModifiersJson ?? null),
    callbacks: cb,
    turnPersisted,
  };

  const reply = await dispatchReply(ctx, cb.onReplyDelta);
  await persistTurn(conversationId, "", reply, null, id);
  cb.onReplyComplete?.(reply);
  cb.onAnalysis(null);

  void maybeCompressConversation(
    conversationId,
    estimateNonHistoryTokens(profileSlice, comfortableItems, reviewItems),
  );
  return { reply, analysis: null };
}

export async function startDerivedConversation(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  let openingInstruction = "";
  try {
    const derivedContext = await derivePendingAction(conversationId);
    await completeDerivedConversation(conversationId, derivedContext);
    openingInstruction = `Start this newly derived conversation now. Follow the derived conversation context exactly, especially this opening instruction: ${derivedContext.openingInstruction}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failDerivedConversation(conversationId, msg);
    throw e;
  }

  return openConversationWithInstruction(
    conversationId,
    openingInstruction,
    cb,
    turnId,
  );
}

// Kick off a rapid-fire Q&A drill: the AI presents the first situation. The quickfire scenario/rules live in the
// conversation's agent_modifiers_json and reach the reply agent through SESSION ADJUSTMENTS, so only the opening
// instruction is needed here. Subsequent learner answers go through the normal practice runTurn (graded as usual).
export async function startQuickfireSession(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  return openConversationWithInstruction(
    conversationId,
    QUICKFIRE_OPENING_INSTRUCTION,
    cb,
    turnId,
  );
}

// Kick off a dictation drill: the AI presents the first sentence to transcribe (spoken by the UI, text hidden until
// answered). The dictation theme/rules live in agent_modifiers_json and reach the reply agent through SESSION
// ADJUSTMENTS, exactly like rapid-fire; subsequent learner transcriptions go through the normal practice runTurn and
// are graded by the tutor as usual.
export async function startDictationSession(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  return openConversationWithInstruction(
    conversationId,
    DICTATION_OPENING_INSTRUCTION,
    cb,
    turnId,
  );
}

// Open a normal practice conversation on a chosen topic (the AI speaks first). The learner picked a recommended chip
// on the new-chat start page; from here it is an ordinary practice conversation (graded turns, no persistent modifier
// — the topic only seeds this opening turn and then lives on in the conversation history).
export async function startTopicConversation(
  conversationId: string,
  topic: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const openingInstruction = `Open a fresh, casual conversation centered on this topic: "${topic.trim()}". Lead with your own angle or a question that gets the user talking about it, calibrated to their level. Keep it natural and inviting — don't summarize the topic back or quiz them mechanically. Keep your opening to one or two sentences in the target language.`;
  return openConversationWithInstruction(
    conversationId,
    openingInstruction,
    cb,
    turnId,
  );
}

async function runLearningTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  kickoff: boolean,
  turnId?: string,
  offRecord = false,
  displayText?: string,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const conversation = await getConversation(conversationId);
  const agentId = conversation?.learningAgentId;
  if (!agentId)
    throw new Error("This focused lesson has no learning agent linked");

  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error("Learning agent not found");

  const config = loadConfig();
  // Auto-compression: lesson context = rolling summary (older content) + all verbatim turns after the watermark. Falls back to pure verbatim when summary is NULL.
  const [summaryData, dataContext, profileMd] = await Promise.all([
    getSummary(conversationId),
    buildLearningDataContext(agent, config),
    readProfile(config),
  ]);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "learning",
  );
  const historyTurns = toHistoryTurns(
    await getTurnsAfterId(conversationId, summaryData.throughId),
  );

  const id = turnId ?? crypto.randomUUID();
  // Lesson turns do not run observers; turnPersisted exists only to satisfy the ConversationContext shape and resolves after persistence.
  let resolvePersisted!: (value: string) => void;
  const turnPersisted = new Promise<string>((resolve) => {
    resolvePersisted = resolve;
  });
  void turnPersisted.catch(() => {});

  const ctx: LearningContext = {
    kind: "learning_agent",
    provider,
    conversationId,
    turnId: id,
    userInput,
    langs: {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
    },
    experiencePreferences,
    agentName: agent.name,
    agentPrompt: agent.prompt,
    dataContext,
    summary: summaryData.summary ?? "",
    historyTurns,
    kickoff,
    callbacks: cb,
    turnPersisted,
  };

  const reply = await dispatchReply(ctx, cb.onReplyDelta);

  await persistTurn(conversationId, userInput, reply, null, id, {
    excludeFromContext: offRecord,
    displayText,
  });
  resolvePersisted(id);
  cb.onReplyComplete?.(reply);
  // Auto-compression: when approaching the context limit, fold the oldest verbatim turns into the rolling summary in the background. Does not block the next turn's input.
  // Lesson non-history dynamic block = dataContext + agent prompt, which is typically much larger than a normal conversation, so the reserve is raised accordingly.
  // Off-record turns do not enter context; skip compression.
  if (!offRecord) {
    const nonHistoryTokens =
      estimateTokens(dataContext) + estimateTokens(agent.prompt);
    void maybeCompressConversation(conversationId, nonHistoryTokens);
  }
  cb.onAnalysis(null);
  return { reply, analysis: null };
}

// Regenerate the latest conversation reply: re-run the conversation agent with the same user input and the history "before this turn",
// streaming a new reply and overwriting the persisted one. Correction is unchanged (only the AI sentence is replaced; the user's analysis is untouched).
// Only available for normal practice conversations; lesson sessions do not expose this operation.
export async function regenerateReply(
  conversationId: string,
  turnId: string,
  cb: {
    onReplyDelta: (delta: string) => void;
    onReplyComplete?: (reply: string) => void;
    onContext?: (promptTokens: number) => void;
  },
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  // Context composition matches the conversation side of runTurn: summary + verbatim turns after watermark, with profile / review / calibration / session modifiers layered on top.
  const [
    summaryData,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
    conv,
  ] = await Promise.all([
    getSummary(conversationId),
    readProfile(config),
    getComfortableList(),
    getReviewDueList(),
    getProficiencySnapshot(),
    getConversation(conversationId),
  ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  const idx = verbatimTurns.findIndex((t) => t.id === turnId);
  if (idx < 0) throw new Error("Reply to regenerate not found");
  const target = verbatimTurns[idx];
  // History uses only verbatim turns "before this turn": exclude the regenerated turn and everything after it, to avoid feeding the old reply back in.
  const history = formatTurns(verbatimTurns.slice(0, idx));
  const reviewItems = rankMasteryItemsForInput(
    reviewItemsRaw,
    target.userInput,
    history,
  );
  const comfortableItems = rankMasteryItemsForInput(
    comfortableItemsRaw,
    target.userInput,
    history,
  );
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );

  const reply = await converse(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
      experiencePreferences,
      profileSlice: profileSliceForConversation(profileMd),
      comfortableItems,
      reviewItems,
      calibrationHint: proficiency.calibrationHint,
      sessionAdjustments: formatModifierInstructions(
        parseAgentModifiers(conv?.agentModifiersJson ?? null),
      ),
      summary: summaryData.summary ?? "",
      historyTurns: toHistoryTurns(verbatimTurns.slice(0, idx)),
      userInput: target.userInput,
      customInstructions: getBuiltinAgentOverride("builtin:conversation")
        ?.instructions,
    },
    cb.onReplyDelta,
    cb.onContext,
  );

  await updateTurnReply(turnId, reply);
  cb.onReplyComplete?.(reply);
  return reply;
}

// On-demand explanation for a conversation reply: reads the Markdown profile (same source as the conversation agent), streams a native-language explanation.
// Not on the hot path; not persisted — explanations are cheap and can be regenerated on demand.
export async function explainReply(
  reply: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const profileMd = await readProfile(config);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "reading",
  );
  const profileSlice = profileSliceForConversation(profileMd);

  return runTransformer(
    "builtin:transformer:explain",
    HOOKS.turnExplain,
    () =>
      explain(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          level: config.level,
          experiencePreferences,
          profileSlice,
          reply,
          customInstructions: getBuiltinAgentOverride(
            "builtin:transformer:explain",
          )?.instructions,
        },
        onDelta,
      ),
    (text) => ({ chars: text.length }),
  );
}

// Bilingual reading: convert a conversation reply into a target-language/native-language sentence-by-sentence interleave (bilingual Markdown).
// Does not read the profile; not persisted — cheap, regenerated on demand.
export async function bilingualReply(reply: string): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const experiencePreferences = formatExperiencePreferences(
    await readProfile(config),
    "reading",
  );
  return runTransformer(
    "builtin:transformer:bilingual",
    HOOKS.turnBilingual,
    () =>
      bilingual(provider, {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        experiencePreferences,
        reply,
        customInstructions: getBuiltinAgentOverride(
          "builtin:transformer:bilingual",
        )?.instructions,
      }),
    (text) => ({ chars: text.length }),
  );
}

// Suggested reply: under a user message = rewrite the sent meaning into idiomatic target language; under an AI reply = generate the next sentence based on context.
// On-demand transformer; not on the hot path, not persisted, does not update learning counts.
export async function suggestReply(
  conversationId: string,
  turnId: string,
  source: ReplySuggestionSource,
  onDelta: (delta: string) => void,
): Promise<ReplySuggestionResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const [profileMd, turns] = await Promise.all([
    readProfile(config),
    getTurnsAfterId(conversationId, null),
  ]);
  const idx = turns.findIndex((t) => t.id === turnId);
  if (idx < 0) throw new Error("Message for reply suggestion not found");

  const target = turns[idx];
  const contextTurns =
    source === "user_message" ? turns.slice(0, idx) : turns.slice(0, idx + 1);
  const history = formatTurns(
    tailTurnsByChars(contextTurns, SUGGESTION_CONTEXT_CHARS),
  );
  const profileSlice = profileSliceForConversation(profileMd);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );

  return runTransformer(
    "builtin:transformer:reply_suggestion",
    HOOKS.turnReplySuggestion,
    () =>
      suggestReplyText(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          level: config.level,
          experiencePreferences,
          profileSlice,
          history,
          source,
          userMessage: source === "user_message" ? target.userInput : undefined,
          partnerReply: source === "partner_reply" ? target.reply : undefined,
          customInstructions: getBuiltinAgentOverride(
            "builtin:transformer:reply_suggestion",
          )?.instructions,
        },
        onDelta,
      ),
    (result) => ({
      chars: result.text.length,
      finishReason: result.finishReason?.raw,
      source,
    }),
  );
}

// Selection translation/analysis: stream a native-language explanation for a text selection in the conversation, using its surrounding context.
// Does not read the profile; not persisted — cheap, regenerated on demand.
export async function translateSelection(
  selection: string,
  context: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const experiencePreferences = formatExperiencePreferences(
    await readProfile(config),
    "reading",
  );
  return runTransformer(
    "builtin:transformer:translate",
    HOOKS.turnTranslate,
    () =>
      translate(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          experiencePreferences,
          selection,
          context,
          customInstructions: getBuiltinAgentOverride(
            "builtin:transformer:translate",
          )?.instructions,
        },
        onDelta,
      ),
    (text) => ({ chars: text.length }),
  );
}

// LLM-generated conversation title: called after the first message is persisted.
// Silently skips when no provider is configured or the title was already changed by the user.
export async function generateAndSetConversationTitle(
  conversationId: string,
  firstUserInput: string,
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;

  const conv = await getConversation(conversationId);
  if (!conv || conv.title !== DEFAULT_CONVERSATION_TITLE) return;

  const config = loadConfig();
  try {
    const title = await generateAutoTitle(provider, {
      targetLanguage: config.targetLanguage,
      nativeLanguage: config.nativeLanguage,
      firstMessage: firstUserInput,
    });
    if (title) await renameConversation(conversationId, title);
  } catch {
    // Silently fall back — the existing truncated title remains.
  }
}

// Cache of generated input hints, keyed per conversation. Stored in app_state (SQLite) so
// hints survive switching away and reopening the conversation, and app restarts.
// throughTurnId is the last on-record turn at generation time (the watermark): hints reflect
// the conversation state after that turn, so a different last turn means the cache is stale.
const INPUT_HINTS_CACHE_PREFIX = "inputHints:";

interface CachedInputHints {
  throughTurnId: string | null;
  hints: string[];
}

// Load cached hints for a conversation, but only if they were generated for the current
// last-turn watermark. Returns [] on miss/stale/corrupt so callers can regenerate.
export async function loadCachedInputHints(
  conversationId: string,
  throughTurnId: string | null,
): Promise<string[]> {
  const raw = await getAppState(INPUT_HINTS_CACHE_PREFIX + conversationId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CachedInputHints;
    if (parsed.throughTurnId === throughTurnId && Array.isArray(parsed.hints))
      return parsed.hints;
  } catch {
    // Corrupt cache entry — treat as a miss.
  }
  return [];
}

// Generate short coaching hints for the next user reply based on recent conversation history,
// and cache them keyed by the conversation's last-turn watermark.
// Returns an empty array on any error so callers can silently degrade.
export async function generateInputHintsForConversation(
  conversationId: string,
): Promise<string[]> {
  const provider = await getProvider();
  if (!provider) return [];

  const config = loadConfig();
  try {
    const [turns, profileMd] = await Promise.all([
      getTurnsAfterId(conversationId, null),
      readProfile(config),
    ]);
    const recent = tailTurnsByChars(turns, 4000);
    const recentHistory = formatTurns(recent);
    const hints = await generateInputHints(provider, {
      targetLanguage: config.targetLanguage,
      nativeLanguage: config.nativeLanguage,
      level: config.level,
      recentHistory,
      profileSlice: profileSliceForConversation(profileMd),
    });
    if (hints.length > 0) {
      const throughTurnId = turns[turns.length - 1]?.id ?? null;
      await setAppState(
        INPUT_HINTS_CACHE_PREFIX + conversationId,
        JSON.stringify({ throughTurnId, hints } satisfies CachedInputHints),
      );
    }
    return hints;
  } catch {
    return [];
  }
}

// Cached topic recommendations (one global list per start page, derived from the learner's records rather than any one
// conversation). The start page reuses this list verbatim on every open — no model call, no record reads — so
// reopening Rapid Q&A / new chat is instant and stable. The first generated set sticks until the learner taps
// Regenerate, which forces a fresh set. The cache holds just the topic strings; nothing else.
const QUICKFIRE_TOPICS_CACHE_KEY = "quickfireTopics";
const CONVERSATION_TOPICS_CACHE_KEY = "conversationTopics";

// Read the cached chip list. Accepts both the current bare-array shape and the legacy { topics, signature } wrapper so
// existing caches survive the upgrade without a forced regenerate.
async function loadCachedTopics(key: string): Promise<string[]> {
  const raw = await getAppState(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { topics?: unknown } | null)?.topics;
    if (Array.isArray(arr) && arr.every((s) => typeof s === "string"))
      return arr as string[];
  } catch {
    // Corrupt cache entry — treat as a miss.
  }
  return [];
}

export async function loadCachedQuickfireTopics(): Promise<string[]> {
  return loadCachedTopics(QUICKFIRE_TOPICS_CACHE_KEY);
}

// Generate umbrella scenarios for the rapid-fire Q&A start page from the learner's records: weak mastery items,
// profile, and recent conversation topics (with everyday corner cases when records are thin). Always generates — the
// start page only calls this on a cold cache or an explicit Regenerate (opts.avoid) — then caches the result so the
// next open reuses it without a model call. Never throws — returns an empty list on failure so the start page degrades
// to the cached set (or type-your-own).
export async function recommendQuickfireTopics(opts?: {
  avoid?: string[];
}): Promise<string[]> {
  const config = loadConfig();
  const avoid = opts?.avoid ?? [];
  const provider = await getProvider();
  if (!provider) return [];

  try {
    const [weakList, profileMd, convs] = await Promise.all([
      getWeakList(),
      readProfile(config),
      listConversations(),
    ]);
    const recentTopics = convs
      .filter(
        (c) => c.kind === "practice" && c.title !== DEFAULT_CONVERSATION_TITLE,
      )
      .slice(0, 8)
      .map((c) => c.title);
    const profileSlice = profileSliceForConversation(profileMd);
    const weakItems = weakList.map((w) => w.label);

    let usedFallback = false;
    const topics = await generateQuickfireTopics(
      provider,
      {
        targetLanguage: config.targetLanguage,
        nativeLanguage: config.nativeLanguage,
        level: config.level,
        profileSlice,
        weakItems,
        recentTopics,
        avoid,
      },
      (info) => {
        usedFallback = info.usedFallback;
      },
    );
    // Cache only a genuine model result — never the hardcoded fallback, so a transient failure retries next time
    // rather than pinning the fallback list.
    if (topics.length > 0 && !usedFallback) {
      await setAppState(QUICKFIRE_TOPICS_CACHE_KEY, JSON.stringify(topics));
    }
    return topics;
  } catch {
    return [];
  }
}

export async function loadCachedConversationTopics(): Promise<string[]> {
  return loadCachedTopics(CONVERSATION_TOPICS_CACHE_KEY);
}

// Generate conversation topics for the new-chat start page from the learner's profile and recent conversation topics
// (with broadly relatable everyday topics when records are thin). Mirrors recommendQuickfireTopics: always generates —
// the start page only calls this on a cold cache or an explicit Regenerate (opts.avoid) — then caches the result so
// the next open reuses it without a model call. Never throws — returns an empty list on failure so the start page
// degrades to the cached set (or type-your-own).
export async function recommendConversationTopics(opts?: {
  avoid?: string[];
}): Promise<string[]> {
  const config = loadConfig();
  const avoid = opts?.avoid ?? [];
  const provider = await getProvider();
  if (!provider) return [];

  try {
    const [profileMd, convs] = await Promise.all([
      readProfile(config),
      listConversations(),
    ]);
    const recentTopics = convs
      .filter(
        (c) => c.kind === "practice" && c.title !== DEFAULT_CONVERSATION_TITLE,
      )
      .slice(0, 8)
      .map((c) => c.title);
    const profileSlice = profileSliceForConversation(profileMd);

    let usedFallback = false;
    const topics = await generateConversationTopics(
      provider,
      {
        targetLanguage: config.targetLanguage,
        nativeLanguage: config.nativeLanguage,
        level: config.level,
        profileSlice,
        recentTopics,
        avoid,
      },
      (info) => {
        usedFallback = info.usedFallback;
      },
    );
    if (topics.length > 0 && !usedFallback) {
      await setAppState(CONVERSATION_TOPICS_CACHE_KEY, JSON.stringify(topics));
    }
    return topics;
  } catch {
    return [];
  }
}
