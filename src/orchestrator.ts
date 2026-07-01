import { converse } from "./agents/conversation";
import { sanitizeHint } from "./agents/input-hints";
import { getProvider, loadConfig } from "./config";
import { setAppState } from "./db/app-state";
import {
  completeDerivedConversation,
  failDerivedConversation,
  formatModifierInstructions,
  getConversation,
  getConversationModelOverride,
  getSummary,
  parseAgentModifiers,
  parseDictationReply,
} from "./db/conversations";
import { getLearningAgent } from "./db/learning-agents";
import {
  getComfortableList,
  getListeningFocusWords,
  getReviewDueList,
} from "./db/mastery";
import { getProficiencySnapshot } from "./db/proficiency";
import {
  formatTurns,
  getTurn,
  getTurnsAfterId,
  persistTurn,
  toHistoryTurns,
  updateTurnReply,
} from "./db/turns";
import { renderDrillInstructions, renderDrillOpening } from "./drills/render";
import { staticT } from "./i18n";
import { buildLearningDataContext } from "./learning-data";
import { runAbortableStream } from "./lib/abortable-stream";
import { emitAppEvent } from "./lib/app-events";
import { createHintDeltaGate, splitReplyTrailer } from "./lib/hint-trailer";
import { logError } from "./lib/log";
import { rankMasteryItemsForInput } from "./lib/mastery-relevance";
import { estimateTokens } from "./lib/tokens";
import {
  type CachedInputHints,
  drillLangExtras,
  estimateNonHistoryTokens,
  INPUT_HINTS_CACHE_PREFIX,
  loadTurnContextData,
  MissingApiKeyError,
  resolveDrill,
  type TurnCallbacks,
  type TurnResult,
} from "./orchestrator/shared";
import { maybeRunMaintainer } from "./profile/maintainer-runner";
import {
  correctionPreferenceFlags,
  formatExperiencePreferences,
} from "./profile/preferences";
import { profileSliceForConversation, readProfile } from "./profile/profile";
import { maybeCompressConversation } from "./profile/summary-runner";
import {
  derivePendingAction,
  dispatchObservers,
  dispatchReply,
  dispatchTurnAnalysisObservers,
  getBuiltinAgentOverride,
  type LearningContext,
  type PracticeContext,
} from "./runtime";

export * from "./orchestrator/learning-authoring";
export * from "./orchestrator/mastery-review";
export * from "./orchestrator/reply-tools";
export * from "./orchestrator/shared";
export * from "./orchestrator/topics-and-hints";

// The tutor only needs enough context to disambiguate the latest utterance; supply this many recent turns. All verbatim turns after the watermark go to the conversation agent.
const TUTOR_HISTORY_TURNS = 8;

// Off-record slash turn (/btw): answer one standalone question with no chat/lesson history,
// no review weaving, no correction, and no future context footprint.
async function runStandaloneSideQuestion(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const conversation = await getConversation(conversationId);
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
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

  try {
    await persistTurn(conversationId, userInput, reply, null, id, {
      excludeFromContext: true,
    });
  } catch (e) {
    rejectPersisted(e); // persistence failed → observers abandon bookkeeping instead of awaiting forever
    throw e;
  }
  resolvePersisted(id);
  cb.onReplyComplete?.(reply);
  return { reply, analysis: null };
}

// End-to-end single turn: conversation ∥ tutor in parallel → streaming reply immediately, correction arrives later → accounting + persistence.
// A tutor crash does not affect the conversation (graceful degradation: analysis=null, mastery not updated this turn).
export async function runTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
  opts: {
    offRecord?: boolean;
    displayText?: string;
    signal?: AbortSignal;
    /** Dictation: replays of the previous sentence before this answer (slow replays included). */
    replayCount?: number;
    /** "Say it again": this message re-produces the learner's previous sentence using the correction, from memory. */
    redo?: boolean;
  } = {},
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

  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
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
  const previousPartnerReply =
    [...verbatimTurns].reverse().find((turn) => turn.reply.trim())?.reply ?? "";
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
  // Drill conversations: resolve the drill document (live row preferred, snapshot fallback) and derive
  // the per-turn behavior from its enums — interaction (say mechanics), grading, mastery, hints, feed.
  const drill = await resolveDrill(agentModifiers);
  const isSayDrill = drill?.def.interaction === "say-hidden";
  // Say drills with standard-answer grading: the target sentence is the one the prior AI turn presented
  // (the last verbatim reply). Hand it to the tutor so grading is a comparison, not free-form correction.
  const dictationStandardAnswer =
    isSayDrill && drill?.def.grading === "standard-answer"
      ? parseDictationReply(
          verbatimTurns[verbatimTurns.length - 1]?.reply ?? "",
        ).sentence || undefined
      : undefined;
  // feed: listening-words — load the listening-weak words so the reply agent can weave them into upcoming sentences.
  const dictationFocusWords =
    drill?.def.feed === "listening-words"
      ? await getListeningFocusWords()
      : undefined;
  // In-band input hint: the reply agent appends a private [[HINT]] trailer that becomes
  // the input-box hint (full context, no extra call). Drills opt in via hints: on (all
  // built-ins keep it off); also gated by the user's auto-hints setting.
  const wantsInlineHint =
    (drill ? drill.def.hints === "on" : true) && config.inputHintsAuto;
  // Drills with snapshotted target items (setup: review-items): the items go to the FRONT of the tutor's weak list,
  // so it reuses exactly these keys and its "correct" signals land on them (dropUntrackedCorrects keeps corrects only for listed keys).
  const drillItems = drill?.params.items ?? [];
  const weakListWithDrill =
    drillItems.length > 0
      ? [
          ...drillItems.map((item) => ({
            key: item.key,
            label: item.label,
            type: item.type,
            status: "struggling",
            example: item.example,
            notes: item.notes,
          })),
          ...weakList.filter(
            (w) => !drillItems.some((item) => item.key === w.key),
          ),
        ]
      : weakList;

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
    previousPartnerReply,
    weakList: weakListWithDrill,
    keyHints,
    comfortableItems,
    reviewItems,
    proficiency,
    agentModifiers,
    drill,
    dictationStandardAnswer,
    dictationFocusWords,
    sayDrillReplayCount: opts.replayCount,
    redoTurn: opts.redo,
    includeHintTrailer: wantsInlineHint,
    callbacks: cb,
    turnPersisted,
  };

  // Reply ∥ observer triggered in parallel. Observers are fire-and-forget; they wait for turnPersisted themselves before running accounting.
  // Off-record turns are not corrected: do not dispatch observers; instead tell the UI immediately that this turn has no correction (clears the "analyzing" state).
  // The reply is abortable (stop generating): on abort it resolves with the partial streamed so far, which is then persisted normally.
  // The delta gate keeps the private [[HINT]] trailer (and a chunk-split marker) out of the live display.
  const replyPromise = runAbortableStream(
    (onDelta) => dispatchReply(ctx, onDelta),
    createHintDeltaGate(cb.onReplyDelta),
    opts.signal,
  );
  // Neither off-record nor prompt-macro turns are graded: the former is a side question, the latter an app directive.
  if (offRecord || isPromptMacro) cb.onAnalysis(null);
  else dispatchObservers(ctx);

  let rawReply: string;
  try {
    rawReply = await replyPromise;
  } catch (e) {
    rejectPersisted(e); // reply failed → turn is not persisted, observers abandon accounting (consistent with pre-migration behavior)
    throw e;
  }
  // Strip the private [[HINT]] trailer: only the visible part is persisted, spoken,
  // and returned. The hint is cached below as this turn's input-box hint.
  const { visible: reply, hint: trailerHint } = splitReplyTrailer(rawReply);

  try {
    await persistTurn(conversationId, userInput, reply, null, id, {
      excludeFromContext: offRecord,
      displayText: opts.displayText,
    });
  } catch (e) {
    rejectPersisted(e); // persistence failed → observers abandon bookkeeping instead of awaiting forever
    throw e;
  }
  resolvePersisted(id);
  cb.onReplyComplete?.(reply);

  // Cache the in-band hint before returning, so the UI's post-reply check finds it
  // (and skips the standalone-generator fallback). Cache failure only costs that
  // fallback call — never the turn.
  const inlineHint =
    wantsInlineHint && trailerHint ? sanitizeHint(trailerHint) : "";
  if (inlineHint) {
    try {
      await setAppState(
        INPUT_HINTS_CACHE_PREFIX + conversationId,
        JSON.stringify({
          throughTurnId: id,
          hints: [inlineHint],
        } satisfies CachedInputHints),
      );
      emitAppEvent("input-hints-changed", { conversationId });
    } catch (e) {
      logError("turn", "In-band hint cache write failed", e);
    }
  }

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

export async function retryTurnAnalysis(
  conversationId: string,
  turnId: string,
  cb: Pick<TurnCallbacks, "onAnalysis">,
): Promise<void> {
  const target = await getTurn(turnId);
  if (!target || target.conversationId !== conversationId) {
    throw new Error("Turn not found");
  }
  if (
    target.excludeFromContext === 1 ||
    target.displayText ||
    !target.userInput.trim()
  ) {
    cb.onAnalysis(null);
    return;
  }

  const conversation = await getConversation(conversationId);
  if (conversation?.kind === "learning_agent") {
    cb.onAnalysis(null);
    return;
  }

  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };
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
  const targetIndex = verbatimTurns.findIndex((turn) => turn.id === turnId);
  const contextTurns =
    targetIndex >= 0
      ? verbatimTurns.slice(0, targetIndex)
      : verbatimTurns.filter((turn) => turn.createdAt < target.createdAt);
  const history = formatTurns(contextTurns);
  const tutorHistory = formatTurns(contextTurns.slice(-TUTOR_HISTORY_TURNS));
  const previousPartnerReply =
    [...contextTurns].reverse().find((turn) => turn.reply.trim())?.reply ?? "";
  const weakList = rankMasteryItemsForInput(
    weakListRaw,
    target.userInput,
    tutorHistory,
  );
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
  const profileSlice = profileSliceForConversation(profileMd);
  const tutorPreferences = formatExperiencePreferences(profileMd, "tutor");
  const tutorFlags = correctionPreferenceFlags(profileMd);
  const agentModifiers = parseAgentModifiers(
    conversation?.agentModifiersJson ?? null,
  );
  const drill = await resolveDrill(agentModifiers);
  const isSayDrill = drill?.def.interaction === "say-hidden";
  const dictationStandardAnswer =
    isSayDrill && drill?.def.grading === "standard-answer"
      ? parseDictationReply(contextTurns[contextTurns.length - 1]?.reply ?? "")
          .sentence || undefined
      : undefined;
  const dictationFocusWords =
    drill?.def.feed === "listening-words"
      ? await getListeningFocusWords()
      : undefined;

  dispatchTurnAnalysisObservers({
    kind: "practice",
    provider,
    conversationId,
    turnId,
    userInput: target.userInput,
    langs,
    profileSlice,
    conversationPreferences: "",
    tutorPreferences,
    tutorFlags,
    summary: summaryData.summary ?? "",
    historyTurns: toHistoryTurns(contextTurns),
    tutorHistory,
    previousPartnerReply,
    weakList,
    keyHints,
    comfortableItems,
    reviewItems,
    proficiency,
    agentModifiers,
    drill,
    dictationStandardAnswer,
    dictationFocusWords,
    callbacks: {
      onReplyDelta: () => {},
      onAnalysis: cb.onAnalysis,
    },
    turnPersisted: Promise.resolve(turnId),
  });
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
  const conv = await getConversation(conversationId);
  const provider = await getProvider(getConversationModelOverride(conv));
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };

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
  const openingModifiers = parseAgentModifiers(
    conv?.agentModifiersJson ?? null,
  );
  const drill = await resolveDrill(openingModifiers);
  // feed: listening-words — the kickoff also gets the listening review words, so even the first sentence can re-expose one.
  const dictationFocusWords =
    drill?.def.feed === "listening-words"
      ? await getListeningFocusWords()
      : undefined;

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
    agentModifiers: openingModifiers,
    drill,
    dictationFocusWords,
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

// Kick off a drill session: the AI opens with the drill's # Opening instruction (say drills get the
// [[SAY]] wrapping requirement appended by code). The drill rules/params live in agent_modifiers_json
// and reach the reply agent through SESSION ADJUSTMENTS; subsequent learner answers go through the
// normal graded runTurn.
export async function startDrillSession(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const conv = await getConversation(conversationId);
  const drill = await resolveDrill(
    parseAgentModifiers(conv?.agentModifiersJson ?? null),
  );
  if (!drill) throw new Error("This conversation has no drill configured");
  const opening = renderDrillOpening(
    drill.def,
    drill.params,
    drillLangExtras(loadConfig()),
  );
  return openConversationWithInstruction(conversationId, opening, cb, turnId);
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
  const conversation = await getConversation(conversationId);
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) throw new MissingApiKeyError();

  const agentId = conversation?.learningAgentId;
  if (!agentId) throw new Error(staticT("errors.lessonNoAgent"));

  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error(staticT("errors.agentNotFound"));

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
  // Lesson chat also feeds the profile: personal facts and interests said in class should reach
  // the maintainer just like practice turns (its transcript already includes lesson turns).
  // Kickoff turns carry no learner speech; off-record turns are excluded from context.
  if (!offRecord && userInput.trim()) void maybeRunMaintainer();
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
  const conv = await getConversation(conversationId);
  const provider = await getProvider(getConversationModelOverride(conv));
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  // Context composition matches the conversation side of runTurn: summary + verbatim turns after watermark, with profile / review / calibration / session modifiers layered on top.
  const [
    summaryData,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
  ] = await Promise.all([
    getSummary(conversationId),
    readProfile(config),
    getComfortableList(),
    getReviewDueList(),
    getProficiencySnapshot(),
  ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  const idx = verbatimTurns.findIndex((t) => t.id === turnId);
  if (idx < 0) throw new Error(staticT("errors.regenerateTurnNotFound"));
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
  const regenModifiers = parseAgentModifiers(conv?.agentModifiersJson ?? null);
  const regenDrill = await resolveDrill(regenModifiers);

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
      sessionAdjustments: formatModifierInstructions(regenModifiers, {
        drillBlock: regenDrill
          ? renderDrillInstructions(
              regenDrill.def,
              regenDrill.params,
              drillLangExtras(config),
            )
          : undefined,
      }),
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
