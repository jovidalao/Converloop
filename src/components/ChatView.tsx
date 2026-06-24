import {
  ArrowUpIcon,
  ChevronDownIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TutorAnalysis } from "../agents/schema";
import {
  matchSlashCommands,
  parseSlashInput,
  type SlashCommand,
  slashMenuToken,
} from "../commands";
import {
  findModelOption,
  getContextLimitForSelection,
  isOAuthProvider,
  loadConfig,
  PROVIDER_PRESETS,
  type ProviderSelection,
  providerModelLabel,
  providerModels,
  useConfig,
} from "../config";
import {
  getConversation,
  getConversationModelOverride,
  type NewConversationContext,
  parseAgentModifiers,
  parseDictationReply,
  setConversationModelOverride as saveConversationModelOverride,
  streamingDictationFeedback,
  touchConversation,
  truncateConversationFrom,
} from "../db/conversations";
import {
  getLearningAgent,
  type LearningAgentMeta,
} from "../db/learning-agents";
import {
  type ChatTurn,
  incrementBilingualCount,
  incrementExplainCount,
  loadChatHistory,
} from "../db/turns";
import { BUILTIN_DRILL_IDS } from "../drills/builtins";
import { localizeDrill } from "../drills/format";
import type {
  DrillDefinition,
  DrillParams,
  DrillSummary,
} from "../drills/types";
import { useTranslation } from "../i18n";
import {
  actionAriaKeyshortcuts,
  actionShortcutLabel,
  actionShortcutTitle,
  matchesActionShortcut,
  useKeybindings,
} from "../lib/app-actions";
import { onAppEvent } from "../lib/app-events";
import { type DisplayError, describeError } from "../lib/error-display";
import { estimatePromptTokens } from "../lib/tokens";
import {
  generateAndSetConversationTitle,
  generateInputHintsForConversation,
  loadCachedConversationTopics,
  loadCachedDrillTopics,
  loadCachedInputHints,
  loadCachedQuickfireTopics,
  recommendConversationTopics,
  recommendQuickfireTopics,
  regenerateReply,
  retryTurnAnalysis,
  runTurn,
  startDerivedConversation,
  startDrillSession,
  startLearningSession,
  startTopicConversation,
} from "../orchestrator";
import { beginAction } from "../runtime";
import {
  loadTtsConfig,
  normalizeAutoSpeakIntervalSeconds,
} from "../tts/config";
import { stopSpeech } from "../tts/playback";
import { speakText } from "../tts/speak";
import { createReplySpeaker, speakAndPlayText } from "../tts/stream";
import { AnnotationIsland } from "./AnnotationIsland";
import {
  CURRENT_MODEL_VALUE,
  MODEL_PROVIDERS,
  ModelLogo,
  modelSelectValue,
  modelShortName,
  parseModelSelectValue,
} from "./chat/model-brand";
import {
  DerivedContextBanner,
  PartnerReply,
  TurnCard,
  UserTurn,
} from "./chat/turns";
import { useConfirm } from "./confirm";
import { conversationActionLabel } from "./conversation-action-display";
import { DictationReply } from "./DictationReply";
import { DrillSessionReport } from "./DrillSessionReport";
import { DrillStartScreen } from "./DrillStartScreen";
import { LessonSessionReview } from "./LessonSessionReview";
import { LessonStartScreen } from "./LessonStartScreen";
import { Markdown } from "./Markdown";
import { MicButton } from "./MicButton";
import { NewChatStartScreen } from "./NewChatStartScreen";
import type { ProviderKind } from "./ProviderStatus";
import { ReviewDrillStartScreen } from "./ReviewDrillStartScreen";
import { SlashBodyHint, SlashMenu } from "./SlashMenu";
import { ThinkingIndicator } from "./TurnActivity";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { Spinner } from "./ui/spinner";

interface ChatViewProps {
  conversationId: string;
  isDraft?: boolean;
  /** This draft is a drill start page (only meaningful when isDraft): show the drill's start screen
   *  and treat the first commit (chip / typed theme / Start) as the session params. */
  drillDraft?: DrillSummary | null;
  /** This draft is a lesson start page. The conversation row is created only when Start is pressed. */
  isLearningAgentDraft?: boolean;
  /** Metadata for the selected lesson draft, shown before the row exists in SQLite. */
  learningAgentDraft?: Pick<
    LearningAgentMeta,
    "id" | "name" | "description"
  > | null;
  mode?: "practice" | "learning_agent";
  /** Fires after a new turn is persisted (title may have changed, sidebar needs refresh). */
  onActivity?: () => void;
  /** Called after the first turn of a draft conversation is persisted; creates the real conversation row. */
  onCreateDraftConversation?: (id: string) => Promise<void>;
  /** Materialize a drill draft into a real conversation with the chosen params (called before the AI kickoff). */
  onCreateDrillDraft?: (
    id: string,
    drill: DrillSummary,
    params: DrillParams,
  ) => Promise<void>;
  /** Materialize a new-chat draft into a real conversation seeded with the chosen topic (called before the AI opens the chat). */
  onCreateTopicDraft?: (id: string, topic: string) => Promise<void>;
  /** Materialize a lesson draft into a real learning-agent conversation before the AI kickoff. */
  onCreateLearningAgentDraft?: (id: string, agentId: string) => Promise<void>;
  /** Reports all turns to the coach panel; re-reported when analysis arrives (read-only, doesn't affect this component's logic). */
  onTurnsChange?: (turns: ChatTurn[]) => void;
  /** Called when a conversation action creates a branch; App switches to the new conversation. */
  onNavigateConversation?: (id: string) => void;
  /** Opens the slash-command settings page (the "Customize commands…" footer in the slash menu). */
  onOpenCommandSettings?: () => void;
  /** Opens the settings section for a provider summary item on the new-chat start page (LLM / TTS / STT). */
  onOpenProviderSettings?: (kind: ProviderKind) => void;
  /** Small-window mode: strip to bare chat — message bubbles + copy + composer; hide explain/speak/corrections/badges/slash menu. */
  compact?: boolean;
  /** Text requested by another panel (currently Coach hints) to draft into the composer. */
  externalDraft?: { text: string; nonce: number } | null;
}

const SETTINGS_DEFAULT_MODEL_VALUE = "__settings_default_model__";

const INPUT_TEXTAREA_MIN_HEIGHT = 56;
const INPUT_TEXTAREA_MAX_HEIGHT = 104;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function idiomaticAutoSpeakText(analysis: TutorAnalysis | null): string | null {
  if (!analysis || analysis.expression_gap) return null;
  const natural = analysis.natural?.trim();
  if (!natural) return null;
  const corrected = analysis.corrected?.trim();
  return natural === corrected ? null : natural;
}

export function ChatView({
  conversationId,
  isDraft = false,
  drillDraft = null,
  isLearningAgentDraft = false,
  learningAgentDraft = null,
  mode = "practice",
  onActivity,
  onCreateDraftConversation,
  onCreateDrillDraft,
  onCreateTopicDraft,
  onCreateLearningAgentDraft,
  onTurnsChange,
  onNavigateConversation,
  onOpenCommandSettings,
  onOpenProviderSettings,
  compact = false,
  externalDraft = null,
}: ChatViewProps) {
  const { t, locale } = useTranslation();
  useKeybindings();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreamingState] = useState("");
  // Estimated prompt size (tokens) of the last turn actually sent to the model — the real context the model
  // received (system prompt + scaffolds + summary + history + input), reported by the reply agent via onContext.
  // null until the first send this session; the context meter then falls back to a bubble-only estimate.
  const [lastPromptTokens, setLastPromptTokens] = useState<number | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  // Shown when the user has scrolled up away from the bottom: a "jump to latest"
  // affordance so streamed replies arriving below the fold aren't missed.
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  // True while a graded send is streaming and can be stopped; drives the Stop
  // button. Only the practice send path is abortable — AI-initiated openings
  // (lesson/derived/drill kickoffs) are short and leave this false.
  const [stoppable, setStoppable] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [derivationPreparing, setDerivationPreparing] = useState(false);
  // Derived conversation context (shown in the collapsible header); null for regular conversations.
  const [derivedBanner, setDerivedBanner] = useState<{
    context: NewConversationContext;
    actionId?: string;
    fallbackLabel?: string;
  } | null>(null);
  // The drill behind this conversation (null for plain practice): definition snapshot + item count.
  // Drives the mode badge, the interaction mechanics (say masking / gates) and drill-flavored actions.
  const [activeDrill, setActiveDrill] = useState<{
    modeId: string;
    def: DrillDefinition;
    itemCount: number;
  } | null>(null);
  // Redo invitation after the learner taps "Say it again" on a correction: a banner above the composer asking them
  // to re-produce the corrected meaning from memory; cleared on send or dismiss.
  const [redoActive, setRedoActive] = useState(false);
  // After a transcription is graded, the next sentence is generated + its audio prefetched in the background, but it is
  // NOT spoken and the listen card is replaced by a "next question" gate. The learner reads their correction, then taps
  // the gate to start the next item (plays the audio, re-enables input). True only between submit and that tap.
  const [dictationAwaitingEnter, setDictationAwaitingEnter] = useState(false);
  // Lesson start screen: name + intro of the picked focused lesson, shown before its first turn fires (null until
  // resolved, or once the lesson has started). The Start button kicks off the lesson.
  const [lessonInfo, setLessonInfo] = useState<{
    name: string;
    description: string;
  } | null>(null);
  // Drill start page: recommended topics (null = still loading, [] = none → type-your-own). Only one
  // drill draft can be active per ChatView mount (remounts per draft id), so a single state set serves
  // every drill; the recommender is picked per drill (see the effect below).
  const [drillTopics, setDrillTopics] = useState<string[] | null>(null);
  // True while a fresh recommendation fetch is in flight — drives the loading skeletons while there are no chips.
  const [drillTopicsRefreshing, setDrillTopicsRefreshing] = useState(false);
  // Bumped by the regenerate button to re-run the recommendation fetch.
  const [drillReloadTick, setDrillReloadTick] = useState(0);
  // Topics on screen when regenerate was clicked — passed to the next fetch as "avoid these" so it returns a different set.
  const drillAvoidRef = useRef<string[]>([]);
  // New-chat start page: recommended conversation topics (null = still loading, [] = none → type-your-own), mirroring
  // the Rapid Q&A topic state. Picking a chip lets the AI open the chat on that topic.
  const [newChatTopics, setNewChatTopics] = useState<string[] | null>(null);
  const [newChatTopicsRefreshing, setNewChatTopicsRefreshing] = useState(false);
  const [newChatReloadTick, setNewChatReloadTick] = useState(0);
  const newChatAvoidRef = useRef<string[]>([]);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  // Retry entry for the last failed operation (send / regenerate / lesson start all share the bottom error bar).
  const [retry, setRetry] = useState<{ run: () => void } | null>(null);
  // A single most-relevant hint (no carousel rotation); rendered from inputHints[0].
  const [inputHints, setInputHints] = useState<string[] | null>(null);
  // Manual "try another" from the hint overlay; ref guards double-clicks.
  const [hintRegenerating, setHintRegenerating] = useState(false);
  const hintRegeneratingRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingFrameRef = useRef<number | null>(null);
  const streamingBufferRef = useRef("");
  const hintOverlayRef = useRef<HTMLDivElement>(null);
  // Streaming voice input: remember the composer draft before speech starts.
  // Partials append after it; onTranscript("") restores it on cancel/error.
  const sttBaseRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const turnGenRef = useRef(0);
  const replyCommittedRef = useRef(false);
  const kickoffStartedRef = useRef(false);
  const derivationStartedRef = useRef(false);
  const drillStartedRef = useRef(false);
  const topicStartedRef = useRef(false);
  const latestBilingualToggleRef = useRef<{
    turnId: string;
    toggle: () => void;
  } | null>(null);
  const latestSpeakTriggerRef = useRef<{
    turnId: string;
    trigger: () => void;
  } | null>(null);
  const latestExplanationToggleRef = useRef<{
    turnId: string;
    toggle: () => void;
  } | null>(null);
  const latestReadingGuideToggleRef = useRef<{
    turnId: string;
    toggle: () => void;
  } | null>(null);
  const chatShortcutActionsRef = useRef<{
    latestTurnId?: string;
    latestReplyText: string;
    canRefreshHints: boolean;
    refreshHints: () => void;
    canRegenerateLatest: boolean;
    regenerateLatest: () => void;
    jumpToLatest: () => void;
  }>({
    latestReplyText: "",
    canRefreshHints: false,
    refreshHints: () => {},
    canRegenerateLatest: false,
    regenerateLatest: () => {},
    jumpToLatest: () => {},
  });
  // Replays of the sentence currently awaiting an answer (including slow replays); sent with the
  // next answer as a live difficulty signal, then reset for the next sentence.
  const sayDrillReplayCountRef = useRef(0);
  const liveTurnIdsRef = useRef<Set<string>>(new Set()); // turns sent in this session; auto-bilingual only applies to these
  const config = useConfig();
  const [conversationModelOverride, setConversationModelOverrideState] =
    useState<ProviderSelection | null>(null);
  const { nativeLanguage, autoBilingual } = config;
  const confirm = useConfirm();
  const learningMode = mode === "learning_agent";

  const showError = useCallback((message: string) => {
    setError({ summary: message });
  }, []);

  const showUnknownError = useCallback(
    (e: unknown) => {
      setError(describeError(e, t));
    },
    [t],
  );

  const registerLatestBilingualToggle = useCallback(
    (turnId: string, toggle: (() => void) | null) => {
      if (toggle) {
        latestBilingualToggleRef.current = { turnId, toggle };
        return;
      }
      if (latestBilingualToggleRef.current?.turnId === turnId) {
        latestBilingualToggleRef.current = null;
      }
    },
    [],
  );

  const registerLatestSpeakTrigger = useCallback(
    (turnId: string, trigger: (() => void) | null) => {
      if (trigger) {
        latestSpeakTriggerRef.current = { turnId, trigger };
        return;
      }
      if (latestSpeakTriggerRef.current?.turnId === turnId) {
        latestSpeakTriggerRef.current = null;
      }
    },
    [],
  );

  const registerLatestExplanationToggle = useCallback(
    (turnId: string, toggle: (() => void) | null) => {
      if (toggle) {
        latestExplanationToggleRef.current = { turnId, toggle };
        return;
      }
      if (latestExplanationToggleRef.current?.turnId === turnId) {
        latestExplanationToggleRef.current = null;
      }
    },
    [],
  );

  const registerLatestReadingGuideToggle = useCallback(
    (turnId: string, toggle: (() => void) | null) => {
      if (toggle) {
        latestReadingGuideToggleRef.current = { turnId, toggle };
        return;
      }
      if (latestReadingGuideToggleRef.current?.turnId === turnId) {
        latestReadingGuideToggleRef.current = null;
      }
    },
    [],
  );

  const setStreaming = useCallback((next: string) => {
    streamingBufferRef.current = next;
    if (next === "") {
      if (streamingFrameRef.current !== null) {
        window.cancelAnimationFrame(streamingFrameRef.current);
        streamingFrameRef.current = null;
      }
      setStreamingState("");
      return;
    }
    if (streamingFrameRef.current !== null) return;
    streamingFrameRef.current = window.requestAnimationFrame(() => {
      streamingFrameRef.current = null;
      setStreamingState(streamingBufferRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (streamingFrameRef.current !== null) {
        window.cancelAnimationFrame(streamingFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!externalDraft) return;
    setInput(externalDraft.text);
    setInputHints(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [externalDraft]);
  // Drill start page: an uncommitted drill draft (no conversation row yet). Drives the drill start
  // screen and routes the first commit (chip / typed setup / Start) through startDrillDraft.
  const drillDraftActive = isDraft && drillDraft !== null;
  // The drill definition shaping this view: the draft's (start page) or the loaded conversation's.
  const drillDef = drillDraft?.def ?? activeDrill?.def ?? null;
  // say-hidden (dictation family): masked-sentence rendering; the learner answers by ear.
  const isDictation = drillDef?.interaction === "say-hidden";
  const isSayDrill = isDictation;
  // Drills targeting snapshotted review items: extra progress badge.
  const isReviewDrill = drillDef?.setup === "review-items";
  // Practice sub-mode for the turn renderers: each drill family trims actions that don't apply.
  // Say drills reuse the dictation variant (fixed target sentence → no "more natural").
  const practiceVariant:
    | "quickfire"
    | "dictation"
    | "review_drill"
    | undefined = isSayDrill
    ? "dictation"
    : isReviewDrill
      ? "review_drill"
      : drillDef
        ? "quickfire"
        : undefined;
  // New-chat start page: a plain uncommitted practice draft (not a drill / lesson). Drives the topic start
  // screen; picking a chip materializes the conversation and the AI opens it on that topic. The composer still sends a
  // normal first turn (type-your-own), so this only changes the empty-state, not the send path.
  const newChatDraftActive =
    isDraft && !drillDraft && !isLearningAgentDraft && !learningMode;
  // Lesson start page: an uncommitted lesson draft (no conversation row yet). Start materializes it, then runs the
  // same kickoff path as an existing empty lesson conversation.
  const lessonDraftActive = isDraft && isLearningAgentDraft;
  // Lesson start screen is up (learning conversation not yet kicked off): the composer is a no-op gate — the only way
  // in is the Start button, so disable input and let the AI open the lesson as designed.
  const lessonGateActive = learningMode && turns.length === 0;
  // Coaching hints are rendered as an animated overlay (not the native placeholder, which can't
  // transition between hints). Active only in practice mode, when hints exist and the input is empty.
  const hintsActive =
    !compact &&
    !learningMode &&
    !isSayDrill &&
    !isReviewDrill &&
    !!inputHints &&
    inputHints.length > 0 &&
    input.length === 0;
  const inputHintWatermark = useMemo(
    () => [...turns].reverse().find((tn) => !tn.excludeFromContext)?.id ?? null,
    [turns],
  );

  // Status bar below the input: current model + context usage (rough estimate, see lib/tokens).
  const contextLimit = getContextLimitForSelection(
    config,
    conversationModelOverride,
  );
  // Prefer the real prompt size reported by the reply agent (system prompt + scaffolds + summary + history + input).
  // Before the first send in this conversation (e.g. just reopened), fall back to a transcript-only estimate, which
  // undercounts the fixed prompt overhead but is the only thing available client-side until a turn runs.
  const fallbackTokens = useMemo(() => {
    const parts: string[] = [];
    for (const turn of turns) {
      if (turn.excludeFromContext) continue; // off-record turns (/btw) are excluded from context and usage count
      if (turn.userText) parts.push(turn.userText);
      if (turn.partnerText) parts.push(turn.partnerText);
    }
    if (streaming) parts.push(streaming);
    return estimatePromptTokens(parts);
  }, [turns, streaming]);
  const usedTokens = lastPromptTokens ?? fallbackTokens;
  const usedPercent = Math.min(
    100,
    Math.round((usedTokens / contextLimit) * 100),
  );

  // Slash commands (/btw etc.): menu pops up when input starts with / and the command token is being edited.
  // Keyboard navigation is intercepted in the textarea; Esc closes until the command context is left and re-entered.
  // Action commands only appear when branching is possible (practice mode and not a draft).
  const [slashSelected, setSlashSelected] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashToken = useMemo(() => slashMenuToken(input), [input]);
  const canDerive = !learningMode && !isDraft;
  const slashCommands = useMemo(
    () =>
      slashToken !== null && !slashDismissed
        ? matchSlashCommands(slashToken, {
            canDerive,
            isLearning: learningMode,
          })
        : [],
    [slashToken, slashDismissed, canDerive, learningMode],
  );
  const slashOpen = !compact && !drillDraftActive && slashCommands.length > 0;

  // Body mode ("/topic …"): the menu is closed, but keep the command's hint visible while the
  // arguments are typed — also surfaces why Enter does nothing while a required body is empty.
  // Hidden wherever the menu is (compact / draft start screens take a theme, not commands).
  const draftComposerActive = drillDraftActive;
  const slashBodyHint = useMemo(() => {
    if (compact || draftComposerActive || slashToken !== null) return null;
    const parsed = parseSlashInput(input);
    if (!parsed) return null;
    const c = parsed.command;
    if (!c.argsHint || (c.kind !== "message" && c.kind !== "prompt"))
      return null;
    return { command: c, hasBody: parsed.rest.length > 0 };
  }, [compact, draftComposerActive, slashToken, input]);

  // When leaving the command context (no token), clear the "Esc-closed" flag so the next / re-opens the menu.
  useEffect(() => {
    if (slashToken === null && slashDismissed) setSlashDismissed(false);
  }, [slashToken, slashDismissed]);

  // When the filtered results change, the selected index may be out of bounds — clamp to 0.
  useEffect(() => {
    setSlashSelected((s) => (s < slashCommands.length ? s : 0));
  }, [slashCommands.length]);

  // Input grows with content up to three lines; after that it scrolls internally.
  // When the input is empty, an animated coaching hint is overlaid on top — let it wrap to
  // multiple lines too, growing the box to fit the (clipped at three lines) hint so it isn't
  // cut off to a single line. The overlay has no bottom padding, so add the textarea's pb-2 (8px).
  // biome-ignore lint/correctness/useExhaustiveDependencies: input/hint changes are the intentional triggers; the effect measures inputRef/hintOverlayRef after they change, not the values directly
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    let contentHeight = el.scrollHeight;
    const overlay = hintOverlayRef.current;
    if (overlay)
      contentHeight = Math.max(contentHeight, overlay.scrollHeight + 8);
    const nextHeight = Math.min(
      Math.max(contentHeight, INPUT_TEXTAREA_MIN_HEIGHT),
      INPUT_TEXTAREA_MAX_HEIGHT,
    );
    el.style.height = `${nextHeight}px`;
    el.style.overflowY =
      contentHeight > INPUT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [input, hintsActive, inputHints]);

  function syncStickToBottom() {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stickToBottomRef.current = atBottom;
    // Only offer the jump affordance when there's a meaningful amount scrolled past.
    setShowJumpButton(!atBottom && distanceFromBottom > 120);
  }

  const jumpToLatest = useCallback(() => {
    stickToBottomRef.current = true;
    setShowJumpButton(false);
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const requestLayoutScroll = useCallback(() => {
    setLayoutTick((n) => n + 1);
  }, []);

  const patchTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: kickoff functions read current conversation state; this effect intentionally runs only on conversation/mode switch
  useEffect(() => {
    let cancelled = false;
    setDerivedBanner(null);
    setActiveDrill(null);
    setDictationAwaitingEnter(false);
    setRedoActive(false);
    sayDrillReplayCountRef.current = 0;
    setLessonInfo(null);
    setInputHints(null);
    setConversationModelOverrideState(null);
    setLastPromptTokens(null); // reset the context meter; repopulated on the next send in this conversation
    void loadChatHistory(conversationId).then(async (loaded) => {
      if (cancelled) return;
      setTurns(loaded);
      const conv = isDraft ? null : await getConversation(conversationId);
      if (cancelled) return;
      setConversationModelOverrideState(getConversationModelOverride(conv));
      if (learningMode && loaded.length === 0 && !kickoffStartedRef.current) {
        if (lessonDraftActive) {
          // The gallery / command palette already showed the intro, so a lesson draft starts immediately —
          // no intermediate start screen. startLesson materializes the draft, then runs the kickoff.
          void startLesson();
          return;
        }
        // Don't fire the first turn yet: resolve the lesson and show the start screen (intro + Start button).
        const agent = conv?.learningAgentId
          ? await getLearningAgent(conv.learningAgentId)
          : null;
        if (cancelled) return;
        setLessonInfo({
          name: agent?.name ?? t("app.customLearningFallback"),
          description: agent?.description ?? "",
        });
        return;
      }
      if (!learningMode) {
        const mods = parseAgentModifiers(conv?.agentModifiersJson ?? null);
        if (mods.derivedContext)
          setDerivedBanner({
            context: mods.derivedContext,
            actionId: mods.derivation?.actionId,
            fallbackLabel: mods.derivation?.actionLabel,
          });
        if (mods.drill) {
          setActiveDrill({
            modeId: mods.drill.modeId,
            def: mods.drill.def,
            itemCount: mods.drill.params.items?.length ?? 0,
          });
        }
        if (
          loaded.length === 0 &&
          !derivationStartedRef.current &&
          mods.derivation?.status === "pending"
        ) {
          void startDerived();
          return;
        }
        // Drill conversation: the AI opens with the drill's first prompt/sentence/micro-task.
        if (loaded.length === 0 && !drillStartedRef.current && mods.drill) {
          void startDrill(mods.drill.def);
          return;
        }
        // Restore input hints for the reopened conversation. The watermark is the last
        // on-record turn (off-record /btw turns are excluded from hint generation).
        const lastTurnId =
          [...loaded].reverse().find((tn) => !tn.excludeFromContext)?.id ??
          null;
        if (lastTurnId) {
          const capturedGen = turnGenRef.current;
          const cached = await loadCachedInputHints(conversationId, lastTurnId);
          if (cancelled || turnGenRef.current !== capturedGen) return;
          if (cached.length > 0) setInputHints(cached);
          else if (loadConfig().inputHintsAuto)
            void generateInputHintsForConversation(conversationId).then(
              (hints) => {
                if (
                  !cancelled &&
                  turnGenRef.current === capturedGen &&
                  hints.length > 0
                )
                  setInputHints(hints);
              },
            );
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, learningMode]);

  useEffect(() => {
    if (learningMode || isSayDrill || isReviewDrill || !inputHintWatermark) {
      return;
    }
    let cancelled = false;
    const load = () =>
      void loadCachedInputHints(conversationId, inputHintWatermark).then(
        (hints) => {
          if (!cancelled) setInputHints(hints.length > 0 ? hints : null);
        },
      );
    load();
    const off = onAppEvent("input-hints-changed", (p) => {
      if (p.conversationId === conversationId) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [
    conversationId,
    inputHintWatermark,
    isReviewDrill,
    isSayDrill,
    learningMode,
  ]);

  // Drill start page (setup: topic): when the draft opens, reuse the cached recommendations verbatim —
  // no model call, no record reads. Only a cold cache (first ever) or the Regenerate button generates a
  // fresh set. The built-in scenario drill keeps its corner-case scenario recommender; every other
  // drill shares the general conversation-topic recommender. Clears when committed (drillDraftActive
  // flips false). A different draft has a new id, so ChatView remounts (key={activeId}) and this
  // re-runs fresh; bumping drillReloadTick re-runs this as a manual regenerate.
  const drillDraftId = drillDraft?.id ?? null;
  const drillDraftWantsTopics =
    drillDraftActive && drillDraft?.setup === "topic";
  // biome-ignore lint/correctness/useExhaustiveDependencies: drillDraft is identified by drillDraftId; its setup guidance is stable per draft
  useEffect(() => {
    if (!drillDraftWantsTopics) {
      setDrillTopics(null);
      setDrillTopicsRefreshing(false);
      return;
    }
    const useScenarioRecommender = drillDraftId === BUILTIN_DRILL_IDS.quickfire;
    // Drills with a # Setup section get author-guided recommendations cached per drill; the rest
    // share the general conversation-topic cache.
    const guidance = drillDraft?.def.setupGuidance?.trim();
    const guidedDrill =
      !useScenarioRecommender && guidance && drillDraftId
        ? { id: drillDraftId, guidance }
        : undefined;
    let cancelled = false;
    // tick 0 = initial open; > 0 = a manual regenerate, where we want a clearly different set.
    const regenerate = drillReloadTick > 0;
    setDrillTopicsRefreshing(true);
    // On regenerate, clear the chips so the centered spinner shows and the new set is unmistakable.
    if (regenerate) setDrillTopics(null);
    void (async () => {
      // Initial open: reuse the cached chips verbatim and stop — no model call, no record reads.
      if (!regenerate) {
        const cached = useScenarioRecommender
          ? await loadCachedQuickfireTopics()
          : guidedDrill
            ? await loadCachedDrillTopics(guidedDrill.id)
            : await loadCachedConversationTopics();
        if (cancelled) return;
        if (cached.length > 0) {
          setDrillTopics(cached);
          setDrillTopicsRefreshing(false);
          return;
        }
      }
      const avoid = regenerate ? drillAvoidRef.current : [];
      const result = useScenarioRecommender
        ? await recommendQuickfireTopics({ avoid })
        : await recommendConversationTopics({ avoid, drill: guidedDrill });
      if (cancelled) return;
      if (result.length > 0) setDrillTopics(result);
      // Nothing available (no provider / error and no cache): stop the skeletons.
      else setDrillTopics((cur) => cur ?? []);
      setDrillTopicsRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [drillDraftWantsTopics, drillDraftId, drillReloadTick]);

  // New-chat start page: same shape as the Rapid Q&A effect above — reuse the cached topics verbatim on open (no model
  // call, no record reads); generate only on a cold cache or a manual regenerate. Clears when the draft commits
  // (newChatDraftActive flips false). Bumping newChatReloadTick re-runs this as a manual regenerate.
  useEffect(() => {
    if (!newChatDraftActive) {
      setNewChatTopics(null);
      setNewChatTopicsRefreshing(false);
      return;
    }
    let cancelled = false;
    const regenerate = newChatReloadTick > 0;
    setNewChatTopicsRefreshing(true);
    if (regenerate) setNewChatTopics(null);
    void (async () => {
      if (!regenerate) {
        const cached = await loadCachedConversationTopics();
        if (cancelled) return;
        if (cached.length > 0) {
          setNewChatTopics(cached);
          setNewChatTopicsRefreshing(false);
          return;
        }
      }
      const avoid = regenerate ? newChatAvoidRef.current : [];
      const result = await recommendConversationTopics({ avoid });
      if (cancelled) return;
      if (result.length > 0) setNewChatTopics(result);
      else setNewChatTopics((cur) => cur ?? []);
      setNewChatTopicsRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [newChatDraftActive, newChatReloadTick]);

  // All turns are reported to the coach panel. Turns are patched (new object) when analysis arrives, so re-reporting is automatic.
  useEffect(() => {
    onTurnsChange?.(turns);
  }, [turns, onTurnsChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: turns/streaming/layoutTick are intentional scroll triggers; the effect reads refs only
  useEffect(() => {
    // New content arrived while the user is reading further up — surface the
    // jump affordance instead of yanking them down.
    if (!stickToBottomRef.current) {
      setShowJumpButton(true);
      return;
    }
    setShowJumpButton(false);
    endRef.current?.scrollIntoView({
      behavior: streaming ? "auto" : "smooth",
      block: "end",
    });
  }, [turns, streaming, layoutTick]);

  function commitPartnerReply(turnId: string, reply: string) {
    patchTurn(turnId, { partnerText: reply });
    setStreaming("");
    setReplyBusy(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function refreshInputHintsAfterReply(turnGen: number) {
    if (
      learningMode ||
      isSayDrill ||
      isReviewDrill ||
      !loadConfig().inputHintsAuto
    ) {
      return;
    }
    // reuseCached: the reply usually carried an in-band [[HINT]] trailer that runTurn
    // already cached — this then costs no model call. Only a missing trailer falls
    // back to the standalone generator.
    void generateInputHintsForConversation(conversationId, {
      reuseCached: true,
    }).then((hints) => {
      if (turnGenRef.current === turnGen && hints.length > 0) {
        setInputHints(hints);
      }
    });
  }

  // "Try another" on the hint overlay: re-run generation for the current turn.
  // On failure/empty the old hint stays — worse than a new one, better than blank.
  function regenerateInputHints() {
    if (hintRegeneratingRef.current) return;
    hintRegeneratingRef.current = true;
    setHintRegenerating(true);
    const turnGen = turnGenRef.current;
    void generateInputHintsForConversation(conversationId)
      .then((hints) => {
        if (turnGenRef.current === turnGen && hints.length > 0) {
          setInputHints(hints);
        }
      })
      .finally(() => {
        hintRegeneratingRef.current = false;
        setHintRegenerating(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      });
  }

  const retryCorrection = useCallback(
    (turnId: string) => {
      patchTurn(turnId, {
        analysis: null,
        analysisProse: null,
        analysisPending: true,
        analysisError: null,
        analysisDiagnostic: null,
      });
      void retryTurnAnalysis(conversationId, turnId, {
        onAnalysis: (a, opts) => {
          patchTurn(turnId, {
            analysis: a,
            analysisProse: opts?.proseFeedback ?? null,
            analysisPending: false,
            analysisError: opts?.error ?? null,
            analysisDiagnostic: opts?.diagnostic ?? null,
          });
        },
      }).catch((e) => {
        patchTurn(turnId, {
          analysisPending: false,
          analysisError: describeError(e, t).summary,
        });
      });
    },
    [conversationId, patchTurn, t],
  );

  async function startLesson(replacingId?: string) {
    if (!learningMode || replyBusy || kickoffStartedRef.current) return;
    stopSpeech();
    kickoffStartedRef.current = true;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setTurns((prev) => [
      ...(replacingId ? prev.filter((t) => t.id !== replacingId) : prev),
      {
        id: turnId,
        userText: "",
        analysis: null,
        analysisPending: false,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    try {
      if (lessonDraftActive) {
        if (!learningAgentDraft || !onCreateLearningAgentDraft) {
          throw new Error("This focused lesson has no learning agent linked");
        }
        await onCreateLearningAgentDraft(conversationId, learningAgentDraft.id);
      }
      const result = await startLearningSession(
        conversationId,
        {
          onReplyDelta: (d) => {
            acc += d;
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            commitPartnerReply(turnId, reply);
          },
          onContext: (tokens) => {
            if (turnGenRef.current === turnGen) setLastPromptTokens(tokens);
          },
          onAnalysis: () => {
            patchTurn(turnId, { analysisPending: false });
          },
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
      }
      await touchConversation(conversationId);
      onActivity?.();
    } catch (e) {
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: t("chat.lessonStartFailed"),
      });
      showUnknownError(e);
      // Release the kickoff guard so retry can restart; the failed turn is replaced on retry.
      kickoffStartedRef.current = false;
      setRetry({ run: () => void startLesson(turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
      }
    }
  }

  async function startDerived(replacingId?: string) {
    if (learningMode || replyBusy || derivationStartedRef.current) return;
    stopSpeech();
    derivationStartedRef.current = true;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setDerivationPreparing(true);
    setTurns((prev) => [
      ...(replacingId ? prev.filter((t) => t.id !== replacingId) : prev),
      {
        id: turnId,
        userText: "",
        analysis: null,
        analysisPending: false,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    // Derived conversation opening also auto-speaks (same as regular send); not created when auto-speak is off.
    const speaker = loadTtsConfig().autoSpeak ? createReplySpeaker() : null;
    try {
      const result = await startDerivedConversation(
        conversationId,
        {
          onReplyDelta: (d) => {
            if (turnGenRef.current !== turnGen) return;
            acc += d;
            setDerivationPreparing(false);
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            setDerivationPreparing(false);
            commitPartnerReply(turnId, reply);
            speaker?.finish(reply);
          },
          onContext: (tokens) => {
            if (turnGenRef.current === turnGen) setLastPromptTokens(tokens);
          },
          onAnalysis: () => {
            patchTurn(turnId, { analysisPending: false });
          },
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        setDerivationPreparing(false);
        commitPartnerReply(turnId, result.reply);
        speaker?.finish(result.reply);
      }
      // Context has been written back to the conversation by the orchestrator; read it to light up the top banner.
      const conv = await getConversation(conversationId);
      const mods = parseAgentModifiers(conv?.agentModifiersJson ?? null);
      if (mods.derivedContext)
        setDerivedBanner({
          context: mods.derivedContext,
          actionId: mods.derivation?.actionId,
          fallbackLabel: mods.derivation?.actionLabel,
        });
      await touchConversation(conversationId);
      onActivity?.();
      refreshInputHintsAfterReply(turnGen);
    } catch (e) {
      stopSpeech(); // stop any in-progress TTS on error
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: t("chat.derivationFailed"),
      });
      showUnknownError(e);
      derivationStartedRef.current = false;
      setRetry({ run: () => void startDerived(turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setDerivationPreparing(false);
        setStreaming("");
        setReplyBusy(false);
      } else {
        speaker?.abort(); // this turn was superseded by a new action; stop synthesis
      }
    }
  }

  // Drill kickoff: the AI opens the session (first situation / sentence / micro-task) into an empty
  // drill conversation. Like a derived opening (AI speaks first, no grading) — the drill rules and
  // params already live in the conversation's modifiers, so there is no context-generation step.
  // Subsequent learner answers go through the normal graded send(). Say drills always speak the
  // [[SAY]] sentence (that is the whole point) and never speak the feedback; chat drills follow the
  // global auto-speak setting and speak the full reply.
  async function startDrill(
    defOverride?: DrillDefinition,
    replacingId?: string,
  ) {
    if (learningMode || replyBusy || drillStartedRef.current) return;
    const def = defOverride ?? drillDef;
    const sayDrill = def?.interaction === "say-hidden";
    stopSpeech();
    drillStartedRef.current = true;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setTurns((prev) => [
      ...(replacingId ? prev.filter((t) => t.id !== replacingId) : prev),
      {
        id: turnId,
        userText: "",
        analysis: null,
        analysisPending: false,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    const speaker = sayDrill
      ? createReplySpeaker()
      : loadTtsConfig().autoSpeak
        ? createReplySpeaker()
        : null;
    const finishSpeaker = (reply: string) => {
      if (sayDrill) speaker?.finish(parseDictationReply(reply).sentence);
      else speaker?.finish(reply);
    };
    try {
      const result = await startDrillSession(
        conversationId,
        {
          onReplyDelta: (d) => {
            if (turnGenRef.current !== turnGen) return;
            acc += d;
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            commitPartnerReply(turnId, reply);
            finishSpeaker(reply);
          },
          onContext: (tokens) => {
            if (turnGenRef.current === turnGen) setLastPromptTokens(tokens);
          },
          onAnalysis: () => {
            patchTurn(turnId, { analysisPending: false });
          },
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
        finishSpeaker(result.reply);
      }
      await touchConversation(conversationId);
      onActivity?.();
      if (!sayDrill) refreshInputHintsAfterReply(turnGen);
    } catch (e) {
      stopSpeech();
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: t("chat.drillStartFailed"),
      });
      showUnknownError(e);
      // Release the kickoff guard so retry can restart; the failed turn is replaced on retry.
      drillStartedRef.current = false;
      setRetry({ run: () => void startDrill(def ?? undefined, turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
      } else {
        speaker?.abort();
      }
    }
  }

  // Commit the start-page params (chip / typed setup / Start button): first materialize the real drill
  // conversation so the AI kickoff can read the drill + params from its modifiers, then fire the opening.
  async function startDrillDraft(params: DrillParams) {
    if (!drillDraft || replyBusy || drillStartedRef.current) return;
    if (drillDraft.setup === "topic" && !params.setup?.trim()) return;
    if (drillDraft.setup === "review-items" && !params.items?.length) return;
    setInput("");
    await onCreateDrillDraft?.(conversationId, drillDraft, params);
    // Drive the mode badge + interaction mechanics immediately (state lands before the kickoff streams).
    setActiveDrill({
      modeId: drillDraft.id,
      def: drillDraft.def,
      itemCount: params.items?.length ?? 0,
    });
    await startDrill(drillDraft.def);
  }

  // "Next question" gate tap: the next sentence + its audio were prepared in the background after the last
  // transcription. Reveal the listen card, play the (cached) sentence once, and re-enable transcription.
  function enterNextDictation() {
    if (!dictationAwaitingEnter) return;
    setDictationAwaitingEnter(false);
    sayDrillReplayCountRef.current = 0; // fresh sentence → fresh replay count
    const last = turns[turns.length - 1];
    const sentence = last?.partnerText
      ? parseDictationReply(last.partnerText).sentence
      : "";
    if (sentence) {
      stopSpeech();
      createReplySpeaker().finish(sentence);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // New-chat topic kickoff: the AI opens the conversation on the chosen topic (AI speaks first, no grading), like a
  // derived opening but with no context-generation step — the topic is passed straight to the opening instruction.
  // After this, it is an ordinary practice conversation and subsequent learner answers go through the graded send().
  async function startTopic(topic: string, replacingId?: string) {
    if (learningMode || replyBusy || topicStartedRef.current) return;
    stopSpeech();
    topicStartedRef.current = true;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setTurns((prev) => [
      ...(replacingId ? prev.filter((t) => t.id !== replacingId) : prev),
      {
        id: turnId,
        userText: "",
        analysis: null,
        analysisPending: false,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    const speaker = loadTtsConfig().autoSpeak ? createReplySpeaker() : null;
    try {
      const result = await startTopicConversation(
        conversationId,
        topic,
        {
          onReplyDelta: (d) => {
            if (turnGenRef.current !== turnGen) return;
            acc += d;
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            commitPartnerReply(turnId, reply);
            speaker?.finish(reply);
          },
          onContext: (tokens) => {
            if (turnGenRef.current === turnGen) setLastPromptTokens(tokens);
          },
          onAnalysis: () => {
            patchTurn(turnId, { analysisPending: false });
          },
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
        speaker?.finish(result.reply);
      }
      await touchConversation(conversationId);
      onActivity?.();
      refreshInputHintsAfterReply(turnGen);
    } catch (e) {
      stopSpeech();
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: t("chat.topicStartFailed"),
      });
      showUnknownError(e);
      // Release the kickoff guard so retry can restart; the failed turn is replaced on retry.
      topicStartedRef.current = false;
      setRetry({ run: () => void startTopic(topic, turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
      } else {
        speaker?.abort();
      }
    }
  }

  // Commit a topic from the new-chat start page (chip): first materialize the real practice conversation so the AI
  // opening has a conversation row to read from, then let the AI open the chat on that topic.
  async function startTopicDraft(topic: string) {
    const s = topic.trim();
    if (!s || replyBusy || topicStartedRef.current) return;
    setInput("");
    await onCreateTopicDraft?.(conversationId, s);
    await startTopic(s);
  }

  // opts.text: reuse original text on retry (don't pull from input box);
  // opts.replacingId: replace the failed old turn;
  // opts.offRecord: /btw off-record turn — answered as a standalone side question, not graded, not in context (bubble has a marker).
  // opts.displayText: prompt-macro turn (/topic, /learn, /surprise) — text is the expanded prompt sent to the agent,
  //   displayText is the verbatim command shown in the bubble; these turns are kept in context but not graded.
  // opts.titleSeed: text to seed the auto-title from instead of `text` (the expanded prompt is a poor title source).
  async function send(opts?: {
    text?: string;
    replacingId?: string;
    offRecord?: boolean;
    displayText?: string;
    titleSeed?: string;
    redo?: boolean;
  }) {
    const isRetry = opts?.text !== undefined;
    const text = (opts?.text ?? input).trim();
    if (!text || replyBusy) return;
    // Redo turn ("say it again"): captured before the banner state is consumed below, and carried through retries so
    // the conversation agent keeps treating the re-attempt as a redo, not a brand-new message.
    const redo = opts?.redo ?? redoActive;
    const offRecord = opts?.offRecord ?? false;
    const displayText = opts?.displayText;
    const isPromptMacro = displayText !== undefined;
    const draftAtSend = isDraft;
    stopSpeech();
    const priorTurns = opts?.replacingId
      ? turns.filter((t) => t.id !== opts.replacingId)
      : turns;
    const isFirstMessage = priorTurns.length === 0;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    if (!isRetry) setInput("");
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    // Reset hints for the new turn; hints generation fires after the reply arrives.
    setInputHints(null);
    setTurns((prev) => [
      ...(opts?.replacingId
        ? prev.filter((t) => t.id !== opts.replacingId)
        : prev),
      {
        id: turnId,
        userText: text,
        displayText,
        analysis: null,
        analysisPending: !learningMode && !offRecord && !isPromptMacro,
        excludeFromContext: offRecord,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    setRedoActive(false); // the redo invitation is consumed by this send
    // Dictation: hand the replay count of the answered sentence to the agent (live difficulty signal),
    // then reset for the next sentence.
    const replayCount = isSayDrill ? sayDrillReplayCountRef.current : undefined;
    sayDrillReplayCountRef.current = 0;
    // Abortable: "stop generating" resolves the reply with whatever streamed so far.
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStoppable(true);
    let acc = "";
    // Auto-speak: synthesizes and plays the full reply as a single TTS request once streaming completes.
    // Not created when "auto-speak" is off in settings (the speaker icon can still be used manually).
    // Dictation never auto-plays the next sentence here — it is gated behind the "next question" tap (see speakReply).
    const ttsCfgAtSend = loadTtsConfig();
    const autoSpeakReply =
      !learningMode && !isSayDrill && ttsCfgAtSend.autoSpeak;
    const autoSpeakNatural =
      !learningMode &&
      !isSayDrill &&
      !offRecord &&
      !isPromptMacro &&
      ttsCfgAtSend.autoSpeakNatural;
    const autoSpeakIntervalMs =
      normalizeAutoSpeakIntervalSeconds(ttsCfgAtSend.autoSpeakIntervalSeconds) *
      1000;
    let autoSpeakCancelled = false;
    let resolveReplyAutoSpeak: (() => void) | null = null;
    const replyAutoSpeakDone =
      autoSpeakReply && autoSpeakNatural
        ? new Promise<void>((resolve) => {
            resolveReplyAutoSpeak = resolve;
          })
        : Promise.resolve();
    const finishReplyAutoSpeak = () => {
      resolveReplyAutoSpeak?.();
      resolveReplyAutoSpeak = null;
    };
    const speaker = autoSpeakReply ? createReplySpeaker() : null;
    const speakNatural = (analysis: TutorAnalysis | null) => {
      if (!autoSpeakNatural) return;
      const natural = idiomaticAutoSpeakText(analysis);
      if (!natural) return;
      void (async () => {
        if (autoSpeakReply) {
          await replyAutoSpeakDone;
          if (autoSpeakIntervalMs > 0) await sleep(autoSpeakIntervalMs);
        }
        if (autoSpeakCancelled || turnGenRef.current !== turnGen) return;
        await speakAndPlayText(natural);
      })();
    };
    const speakReply = (reply: string) => {
      // Dictation: pre-synthesize the next sentence (warms the TTS cache, no playback) so tapping "next
      // question" plays it instantly; the tap is what triggers the first playback. Never speak the feedback prose.
      if (isSayDrill) {
        void speakText(parseDictationReply(reply).sentence).catch(() => {});
        return;
      }
      const done = speaker?.finish(reply) ?? Promise.resolve();
      if (resolveReplyAutoSpeak) void done.finally(finishReplyAutoSpeak);
    };
    try {
      const result = await runTurn(
        text,
        conversationId,
        {
          onReplyDelta: (d) => {
            if (turnGenRef.current !== turnGen) return;
            acc += d;
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            commitPartnerReply(turnId, reply);
            speakReply(reply);
          },
          onContext: (tokens) => {
            if (turnGenRef.current === turnGen) setLastPromptTokens(tokens);
          },
          onAnalysis: (a, opts) => {
            patchTurn(turnId, {
              analysis: a,
              analysisProse: opts?.proseFeedback ?? null,
              analysisPending: false,
              analysisError: opts?.error ?? null,
              analysisDiagnostic: opts?.diagnostic ?? null,
            });
            speakNatural(a);
          },
        },
        turnId,
        {
          offRecord,
          displayText,
          signal: controller.signal,
          replayCount,
          redo,
        },
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
        speakReply(result.reply);
      }
      // Dictation: the next sentence is now ready (and its audio prefetched). Gate it behind the "next
      // question" tap so the learner reads the correction first; the tap plays the audio and re-enables input.
      if (turnGenRef.current === turnGen && isSayDrill) {
        setDictationAwaitingEnter(true);
      }
      if (draftAtSend) await onCreateDraftConversation?.(conversationId);
      // Turn persisted: update conversation sort order, auto-name on first message, then refresh sidebar.
      // Off-record turns (/btw) don't define the conversation topic and are excluded from auto-naming.
      await touchConversation(conversationId);
      if ((isFirstMessage || draftAtSend) && !learningMode && !offRecord) {
        // Prompt macros: title from the typed args (/topic, /learn) or, when there are none (/surprise), from the reply.
        const titleSeed = isPromptMacro
          ? opts?.titleSeed?.trim() || result.reply
          : text;
        void generateAndSetConversationTitle(conversationId, titleSeed).then(
          () => onActivity?.(),
        );
      } else onActivity?.();
      // Fire hint generation in the background after the reply is committed; silently ignore errors. Off-record turns
      // are not context, so they should not produce the next-reply hint.
      if (!offRecord) refreshInputHintsAfterReply(turnGen);
    } catch (e) {
      autoSpeakCancelled = true;
      finishReplyAutoSpeak();
      stopSpeech(); // stop any in-progress TTS on error
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: learningMode
          ? t("chat.sendFailed")
          : t("chat.sendFailedNoGrading"),
      });
      showUnknownError(e);
      setRetry({
        run: () =>
          void send({
            text,
            replacingId: turnId,
            offRecord,
            displayText,
            titleSeed: opts?.titleSeed,
            redo,
          }),
      });
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
        setStoppable(false);
        abortControllerRef.current = null;
      } else {
        autoSpeakCancelled = true;
        finishReplyAutoSpeak();
        speaker?.abort(); // turn superseded by a new message; stop synthesis (playback already handed off to new send's stopSpeech)
      }
    }
  }

  // Stop generating: resolve the in-flight reply with the partial streamed so far
  // (the orchestrator persists it and the normal completion path commits it).
  function stopGenerating() {
    abortControllerRef.current?.abort();
  }

  // "Edit from here": after confirmation, discard this turn and all following turns,
  // and put the original text back into the input for re-editing.
  // Only the conversation is deleted — already-recorded learning memory (mastery/profile) is preserved.
  async function editFromHere(turnId: string) {
    // Truncating while grading is in flight would discard the result (observer's onAnalysis writing back to a deleted turn becomes a no-op).
    if (replyBusy || turns.some((turn) => turn.analysisPending)) return;
    const target = turns.find((turn) => turn.id === turnId);
    if (!target) return;
    const ok = await confirm({
      title: t("chat.editFromHereTitle"),
      description: t("chat.editFromHereDesc"),
      confirmText: t("chat.editFromHereConfirm"),
      cancelText: t("common.cancel"),
    });
    if (!ok) return;
    stopSpeech();
    turnGenRef.current++; // invalidate any in-flight turn callbacks; they must not write back to a deleted turn
    await truncateConversationFrom(conversationId, turnId);
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turnId);
      return idx < 0 ? prev : prev.slice(0, idx);
    });
    setError(null);
    setRetry(null);
    // For prompt macros, restore the verbatim command (displayText), not the expanded prompt stored in userText.
    setInput(target.displayText ?? target.userText);
    inputRef.current?.focus();
    await touchConversation(conversationId);
    onActivity?.();
  }

  // Regenerate the latest reply: overwrite that turn's bubble in-place via streaming; restore original text on failure. Corrections remain unchanged.
  async function regenerate(turnId: string) {
    if (replyBusy) return;
    stopSpeech();
    const turnGen = ++turnGenRef.current;
    const original = turns.find((t) => t.id === turnId)?.partnerText ?? "";
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    setReplyBusy(true);
    setRegeneratingId(turnId);
    let acc = "";
    try {
      await regenerateReply(conversationId, turnId, {
        onReplyDelta: (d) => {
          if (turnGenRef.current !== turnGen) return;
          acc += d;
          patchTurn(turnId, { partnerText: acc });
        },
        onReplyComplete: (reply) => {
          if (turnGenRef.current !== turnGen) return;
          patchTurn(turnId, { partnerText: reply });
        },
        onContext: (tokens) => {
          if (turnGenRef.current === turnGen) setLastPromptTokens(tokens);
        },
      });
      await touchConversation(conversationId);
      onActivity?.();
    } catch (e) {
      if (turnGenRef.current === turnGen)
        patchTurn(turnId, { partnerText: original });
      showUnknownError(e);
      setRetry({ run: () => void regenerate(turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setReplyBusy(false);
        setRegeneratingId(null);
      }
    }
  }

  // Conversation action: creates a pending derived conversation and navigates to it;
  // the new page generates context and auto-starts. The original conversation is unchanged (non-destructive, unlike editFromHere which truncates).
  async function runConversationAction(
    actionId: string,
    sourceTurnId?: string,
  ) {
    if (actionBusy || replyBusy) return;
    setActionBusy(true);
    setError(null);
    setRetry(null);
    try {
      const result = await beginAction(actionId, {
        conversationId,
        sourceTurnId,
      });
      onActivity?.();
      if (result.navigateTo) onNavigateConversation?.(result.navigateTo);
    } catch (e) {
      showUnknownError(e);
    } finally {
      setActionBusy(false);
    }
  }

  // Prompt macro (/topic, /learn, /surprise): stays in the conversation as a turn — the bubble shows the verbatim
  // command, the agent receives the expanded prompt. Requires-args commands with an empty body do nothing.
  function runPromptMacro(command: SlashCommand, rest: string) {
    if (!command.buildPrompt) return;
    if (command.requiresArgs && !rest) return;
    const displayText = rest ? `/${command.name} ${rest}` : `/${command.name}`;
    setInput("");
    void send({
      text: command.buildPrompt(rest),
      displayText,
      titleSeed: rest,
    });
  }

  // Submit input: check for slash commands first. "message" type (/btw) sends off-record;
  // "prompt" type (/topic etc.) sends a prompt macro that stays in the conversation;
  // "action" type executes an existing conversation action;
  // non-commands send normally. Arrives here via Enter / Send when the menu is already closed.
  function submitInput() {
    // Lesson start screen: the composer is a disabled gate — the lesson only begins via the Start button.
    if (lessonGateActive) return;
    // Drill start page: with setup "topic" the composer takes a custom theme/scenario, not a graded
    // turn or a slash command; otherwise the composer is a gate — the drill starts via its Start button.
    if (drillDraftActive) {
      if (drillDraft?.setup === "topic") void startDrillDraft({ setup: input });
      return;
    }
    const parsed = parseSlashInput(input);
    if (!parsed) {
      void send();
      return;
    }
    if (parsed.command.kind === "message") {
      if (!parsed.rest) return; // only the command was typed with no body text: don't send
      setInput("");
      void send({ text: parsed.rest, offRecord: true });
      return;
    }
    if (parsed.command.kind === "prompt") {
      runPromptMacro(parsed.command, parsed.rest);
      return;
    }
    if (parsed.command.actionId) {
      setInput("");
      void runConversationAction(parsed.command.actionId);
    }
  }

  // Select a command in the menu (Enter / click): "message"/"prompt" with args complete to "/name " for body input;
  // a no-arg "prompt" (/surprise, /recap) runs immediately; "action" executes immediately.
  function activateSlashCommand(command: SlashCommand) {
    if (command.kind === "action") {
      if (command.actionId) {
        setInput("");
        void runConversationAction(command.actionId);
      }
      return;
    }
    if (command.kind === "prompt" && !command.argsHint) {
      // /surprise (no body): run on the spot. Body-taking macros (/topic, /learn) fall through to body mode below.
      runPromptMacro(command, "");
      return;
    }
    // body-taking command (/btw, /topic, /learn) → "/name " (enter body mode)
    setInput(`/${command.name} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Tab-complete the command name: commands that take a body (have an argsHint, e.g. /btw, /topic, /learn) complete
  // to "/name " (body mode); the rest to "/name" (press Enter to run).
  function completeSlashCommand(command: SlashCommand) {
    setInput(command.argsHint ? `/${command.name} ` : `/${command.name}`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // The latest turn with a partner reply — "Regenerate" is only attached to it.
  let lastReplyTurnId: string | undefined;
  for (const turn of turns) if (turn.partnerText) lastReplyTurnId = turn.id;
  const lastReplyTurn = lastReplyTurnId
    ? turns.find((turn) => turn.id === lastReplyTurnId)
    : undefined;
  const canRegenerateLatestReply = !!(
    lastReplyTurn &&
    !learningMode &&
    !replyBusy &&
    !lastReplyTurn.excludeFromContext
  );
  chatShortcutActionsRef.current = {
    latestTurnId: lastReplyTurnId,
    latestReplyText: lastReplyTurn?.partnerText ?? "",
    canRefreshHints: hintsActive && !hintRegeneratingRef.current,
    refreshHints: regenerateInputHints,
    canRegenerateLatest: canRegenerateLatestReply,
    regenerateLatest: () => {
      if (lastReplyTurn) void regenerate(lastReplyTurn.id);
    },
    jumpToLatest,
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const wantsRefreshHints = matchesActionShortcut(e, "refresh-hints");
      const wantsCopy = matchesActionShortcut(e, "copy-latest-reply");
      const wantsExplanation = matchesActionShortcut(
        e,
        "toggle-latest-explanation",
      );
      const wantsReadingGuide = matchesActionShortcut(
        e,
        "toggle-latest-reading-guide",
      );
      const wantsBilingual = matchesActionShortcut(
        e,
        "toggle-latest-bilingual",
      );
      const wantsSpeak = matchesActionShortcut(e, "speak-latest-reply");
      const wantsRegenerate = matchesActionShortcut(
        e,
        "regenerate-latest-reply",
      );
      const wantsJumpToLatest = matchesActionShortcut(e, "jump-to-latest");
      if (
        !wantsRefreshHints &&
        !wantsCopy &&
        !wantsExplanation &&
        !wantsReadingGuide &&
        !wantsBilingual &&
        !wantsSpeak &&
        !wantsRegenerate &&
        !wantsJumpToLatest
      )
        return;
      if (e.isComposing) return;
      const inModal =
        e.target instanceof HTMLElement &&
        !!e.target.closest("[data-modal-overlay]");
      if (inModal) return;
      const shortcutActions = chatShortcutActionsRef.current;
      if (wantsRefreshHints) {
        e.preventDefault();
        if (shortcutActions.canRefreshHints) shortcutActions.refreshHints();
        return;
      }
      if (wantsJumpToLatest) {
        e.preventDefault();
        shortcutActions.jumpToLatest();
        return;
      }
      if (wantsCopy) {
        e.preventDefault();
        if (shortcutActions.latestReplyText.trim()) {
          void navigator.clipboard.writeText(shortcutActions.latestReplyText);
        }
        return;
      }
      if (wantsExplanation) {
        e.preventDefault();
        const latest = latestExplanationToggleRef.current;
        if (!latest || latest.turnId !== shortcutActions.latestTurnId) return;
        latest.toggle();
        return;
      }
      if (wantsReadingGuide) {
        e.preventDefault();
        const latest = latestReadingGuideToggleRef.current;
        if (!latest || latest.turnId !== shortcutActions.latestTurnId) return;
        latest.toggle();
        return;
      }
      if (wantsBilingual) {
        e.preventDefault();
        const latest = latestBilingualToggleRef.current;
        if (!latest || latest.turnId !== shortcutActions.latestTurnId) return;
        latest.toggle();
        return;
      }
      if (wantsRegenerate) {
        e.preventDefault();
        if (shortcutActions.canRegenerateLatest) {
          shortcutActions.regenerateLatest();
        }
        return;
      }
      e.preventDefault();
      const latest = latestSpeakTriggerRef.current;
      if (!latest || latest.turnId !== shortcutActions.latestTurnId) return;
      latest.trigger();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Dictation masking: the sentence still awaiting an answer is the one in the LAST turn's reply (no turn
  // follows it). All earlier sentences have been answered and are revealed. While a new reply is still streaming, the
  // last turn is the optimistic user turn (no partnerText), so nothing is masked and the previous sentence reveals.
  const dictationMaskedTurnId =
    isSayDrill && turns.length > 0 && turns[turns.length - 1].partnerText
      ? turns[turns.length - 1].id
      : undefined;

  // While a drill reply streams, show only the feedback portion — the sentence stays hidden until it is committed
  // (then it renders as the listen / read-aloud card). For other conversations the full streamed text shows as usual.
  const streamingVisible = isSayDrill
    ? streamingDictationFeedback(streaming)
    : streaming;

  // "Edit from here" truncates the conversation and discards in-flight analysis — disabled until all grading completes.
  const analyzing = turns.some((turn) => turn.analysisPending);

  // Active option badges above the input area: shows at a glance the learning context for this turn
  // (mode + derivation settings). Drill conversations badge the drill's localized name.
  const drillBadgeName = drillDef
    ? (drillDraft?.name ?? localizeDrill(drillDef, locale).name)
    : null;
  const optionBadges: { label: string; tone: "info" | "muted" }[] = [
    learningMode
      ? { label: t("chat.lessonBadge"), tone: "info" }
      : drillBadgeName
        ? { label: drillBadgeName, tone: "info" }
        : { label: t("chat.practiceBadge"), tone: "muted" },
  ];
  // Item-targeting drill progress: answered micro-tasks out of the snapshotted item count (capped —
  // the drill keeps cycling shaky items after the first full pass).
  const drillItemCount = activeDrill?.itemCount ?? 0;
  if (isReviewDrill && drillItemCount > 0) {
    const answered = turns.filter((turn) => turn.userText.trim()).length;
    optionBadges.push({
      label: `${Math.min(answered, drillItemCount)}/${drillItemCount}`,
      tone: "muted",
    });
  }
  const derivedBannerLabel = derivedBanner
    ? derivedBanner.actionId
      ? conversationActionLabel(
          derivedBanner.actionId,
          derivedBanner.fallbackLabel ?? t("chat.derivedBadge"),
          t,
        )
      : (derivedBanner.fallbackLabel ?? t("chat.derivedBadge"))
    : undefined;
  if (derivedBanner) {
    optionBadges.push({
      label: derivedBannerLabel ?? t("chat.derivedBadge"),
      tone: "info",
    });
    const diff = derivedBanner.context.difficulty?.trim();
    if (diff && diff.length <= 16)
      optionBadges.push({
        label: t("chat.difficultyBadge", { diff }),
        tone: "muted",
      });
  }
  const defaultModelSelection: ProviderSelection = {
    providerType: config.providerType,
    model: config.providers[config.providerType].model,
  };
  const activeModelSelection =
    conversationModelOverride ?? defaultModelSelection;
  const active = {
    ...config.providers[activeModelSelection.providerType],
    model: activeModelSelection.model,
  };
  const currentPreset = PROVIDER_PRESETS[activeModelSelection.providerType];
  const currentModelOption = findModelOption(
    activeModelSelection.providerType,
    active,
    active.model,
  );
  const usingPresetEndpoint = active.baseUrl.trim() === currentPreset.baseUrl;
  const currentProviderModelLabel = providerModelLabel(
    activeModelSelection.providerType,
    active.model,
  );
  const currentModelButtonLabel = modelShortName(active.model);
  const selectedModelValue =
    conversationModelOverride == null
      ? SETTINGS_DEFAULT_MODEL_VALUE
      : usingPresetEndpoint && currentModelOption
        ? modelSelectValue(
            activeModelSelection.providerType,
            currentModelOption.model,
          )
        : CURRENT_MODEL_VALUE;
  const contextTitle = t("chat.contextUsage", {
    used: usedTokens.toLocaleString(locale),
    limit: contextLimit.toLocaleString(locale),
    pct: usedPercent,
  });
  const showContextWarning = !compact && usedPercent >= 70;

  async function selectModelProvider(value: string) {
    if (isDraft) return;
    try {
      if (value === SETTINGS_DEFAULT_MODEL_VALUE) {
        await saveConversationModelOverride(conversationId, null);
        setConversationModelOverrideState(null);
        return;
      }
      if (value === CURRENT_MODEL_VALUE) return;
      const selected = parseModelSelectValue(value);
      if (!selected) return;
      const defaultModel = defaultModelSelection;
      const next =
        selected.providerType === defaultModel.providerType &&
        selected.model === defaultModel.model
          ? null
          : selected;
      await saveConversationModelOverride(conversationId, next);
      setConversationModelOverrideState(next);
    } catch (e) {
      showUnknownError(e);
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="chat-scroll-mask flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-3 pb-3"
          ref={messagesRef}
          onScroll={syncStickToBottom}
        >
          {!compact && derivedBanner && (
            <DerivedContextBanner
              conversationId={conversationId}
              context={derivedBanner.context}
              label={derivedBannerLabel}
            />
          )}
          {turns.length === 0 &&
            !streaming &&
            (drillDraftActive && drillDraft ? (
              drillDraft.setup === "review-items" ? (
                <ReviewDrillStartScreen
                  busy={replyBusy}
                  title={drillDraft.name}
                  description={drillDraft.intro}
                  onStart={(items) => void startDrillDraft({ items })}
                />
              ) : (
                <DrillStartScreen
                  drill={drillDraft}
                  topics={drillTopics}
                  refreshing={drillTopicsRefreshing}
                  busy={replyBusy}
                  onPickTopic={(topic) =>
                    void startDrillDraft({ setup: topic })
                  }
                  onStart={() => void startDrillDraft({})}
                  onRefresh={() => {
                    drillAvoidRef.current = drillTopics ?? [];
                    setDrillReloadTick((n) => n + 1);
                  }}
                />
              )
            ) : learningMode ? (
              lessonInfo ? (
                <LessonStartScreen
                  name={lessonInfo.name}
                  description={lessonInfo.description}
                  busy={replyBusy}
                  onStart={() => void startLesson()}
                />
              ) : (
                <div className="m-auto text-center text-ui-body leading-relaxed text-ui-muted">
                  {t("chat.preparingLesson")}
                </div>
              )
            ) : newChatDraftActive ? (
              <NewChatStartScreen
                topics={newChatTopics}
                refreshing={newChatTopicsRefreshing}
                busy={replyBusy}
                onPick={(topic) => void startTopicDraft(topic)}
                onRefresh={() => {
                  newChatAvoidRef.current = newChatTopics ?? [];
                  setNewChatReloadTick((n) => n + 1);
                }}
                onOpenProviderSettings={onOpenProviderSettings}
              />
            ) : (
              <div className="m-auto text-center text-ui-body leading-relaxed text-ui-muted">
                {t("chat.startConversation")}
              </div>
            ))}
          {turns.map((turn) => (
            <TurnCard
              key={turn.id}
              turnId={turn.id}
              live={liveTurnIdsRef.current.has(turn.id)}
            >
              {turn.userText.trim() && (
                <UserTurn
                  turn={turn}
                  conversationId={conversationId}
                  nativeLanguage={nativeLanguage}
                  learningMode={learningMode}
                  variant={practiceVariant}
                  allowedActions={drillDef?.turnActions}
                  onLayoutChange={requestLayoutScroll}
                  editDisabled={analyzing || replyBusy}
                  onEditFrom={() => void editFromHere(turn.id)}
                  onRedo={
                    !learningMode && !isSayDrill
                      ? () => {
                          setRedoActive(true);
                          setInput("");
                          requestAnimationFrame(() =>
                            inputRef.current?.focus(),
                          );
                        }
                      : undefined
                  }
                  onRetryCorrection={retryCorrection}
                  onTurnAction={(actionId) =>
                    void runConversationAction(actionId, turn.id)
                  }
                />
              )}
              {turn.partnerText &&
                (isSayDrill ? (
                  <DictationReply
                    text={turn.partnerText}
                    masked={turn.id === dictationMaskedTurnId}
                    awaitingEnter={
                      turn.id === dictationMaskedTurnId &&
                      dictationAwaitingEnter
                    }
                    onEnter={enterNextDictation}
                    onReplay={() => {
                      sayDrillReplayCountRef.current += 1;
                    }}
                  />
                ) : (
                  <PartnerReply
                    conversationId={conversationId}
                    turnId={turn.id}
                    text={turn.partnerText}
                    allowedActions={drillDef?.turnActions}
                    autoOpen={
                      !learningMode &&
                      autoBilingual &&
                      liveTurnIdsRef.current.has(turn.id)
                    }
                    onFirstExplain={() => void incrementExplainCount(turn.id)}
                    onFirstBilingual={() =>
                      void incrementBilingualCount(turn.id)
                    }
                    onLayoutChange={requestLayoutScroll}
                    onRegenerate={
                      !learningMode &&
                      !replyBusy &&
                      !turn.excludeFromContext &&
                      turn.id === lastReplyTurnId
                        ? () => void regenerate(turn.id)
                        : undefined
                    }
                    regenerating={regeneratingId === turn.id}
                    registerLatestBilingualToggle={
                      turn.id === lastReplyTurnId
                        ? registerLatestBilingualToggle
                        : undefined
                    }
                    registerLatestSpeakTrigger={
                      turn.id === lastReplyTurnId
                        ? registerLatestSpeakTrigger
                        : undefined
                    }
                    registerLatestExplanationToggle={
                      turn.id === lastReplyTurnId
                        ? registerLatestExplanationToggle
                        : undefined
                    }
                    registerLatestReadingGuideToggle={
                      turn.id === lastReplyTurnId
                        ? registerLatestReadingGuideToggle
                        : undefined
                    }
                  />
                ))}
            </TurnCard>
          ))}
          {derivationPreparing && (
            <div className="m-auto flex flex-col items-center gap-2 text-center text-ui-body leading-relaxed text-ui-muted">
              <Spinner />
              <span>{t("chat.preparingContext")}</span>
            </div>
          )}
          {replyBusy &&
            !derivationPreparing &&
            streamingVisible.trim().length < 2 && (
              <ThinkingIndicator className="self-stretch py-0.5" />
            )}
          {streamingVisible.trim().length >= 2 && (
            <div className="self-stretch py-0.5 text-ui-secondary">
              <Markdown>{streamingVisible}</Markdown>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <AnnotationIsland containerRef={messagesRef} />
        {showJumpButton && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="-translate-x-1/2 absolute bottom-3 left-1/2 z-20 flex animate-in items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-ui-caption text-ui-muted shadow-md transition-colors fade-in-0 slide-in-from-bottom-1 hover:text-foreground"
            aria-label={t("chat.jumpToLatest")}
            aria-keyshortcuts={actionAriaKeyshortcuts("jump-to-latest")}
            title={actionShortcutTitle(
              t("chat.jumpToLatest"),
              "jump-to-latest",
            )}
          >
            <ChevronDownIcon size={14} />
            {t("chat.jumpToLatest")}
          </button>
        )}
      </div>
      {error && (
        <div
          className="mx-4 flex items-center gap-3 rounded-md bg-destructive/15 px-3 py-2 text-ui-body text-destructive"
          role="alert"
        >
          <div className="min-w-0 flex-1">
            {error.summary}
            {error.detail && (
              <details className="mt-1 text-ui-caption text-destructive/80">
                <summary className="cursor-pointer">
                  {t("common.details")}
                </summary>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-ui-caption leading-snug">
                  {error.detail}
                </pre>
              </details>
            )}
          </div>
          {retry && !replyBusy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5"
              onClick={() => retry.run()}
            >
              <RefreshCwIcon size={14} />
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      {learningMode && !compact && (
        <LessonSessionReview
          conversationId={conversationId}
          visible={turns.filter((tn) => tn.userText.trim()).length >= 3}
        />
      )}
      {!learningMode && !compact && activeDrill?.def.report && (
        <DrillSessionReport
          conversationId={conversationId}
          visible={turns.filter((tn) => tn.userText.trim()).length >= 3}
        />
      )}
      {redoActive && !replyBusy && (
        <div
          className="mx-4 mb-1 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-ui-caption text-foreground"
          role="status"
        >
          <RotateCcwIcon size={14} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{t("chat.redoPrompt")}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-ui-muted hover:text-foreground"
            onClick={() => setRedoActive(false)}
            aria-label={t("common.close")}
          >
            <XIcon size={13} />
          </button>
        </div>
      )}
      <div className="shrink-0 px-3 pb-3 pt-1.5">
        <div className="relative">
          {slashOpen && (
            <SlashMenu
              commands={slashCommands}
              selected={slashSelected}
              onHover={setSlashSelected}
              onActivate={activateSlashCommand}
              onCustomize={onOpenCommandSettings}
            />
          )}
          {!slashOpen && slashBodyHint && (
            <SlashBodyHint
              command={slashBodyHint.command}
              hasBody={slashBodyHint.hasBody}
            />
          )}
          <div className="overflow-hidden rounded-[var(--radius-panel)] border bg-card shadow-minimal transition-colors">
            <form
              className="flex flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                submitInput();
              }}
            >
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (
                      isSayDrill &&
                      dictationAwaitingEnter &&
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      enterNextDictation();
                      return;
                    }
                    // ⌘⇧V / ⌘⇧H etc. fire while the input is focused (modifier chords don't
                    // collide with typing). ⌘⇧H regenerates the reply hint — same as the refresh
                    // button on the overlay; only acts when a hint is actually shown.
                    if (
                      matchesActionShortcut(e.nativeEvent, "refresh-hints") &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      if (hintsActive && !hintRegeneratingRef.current)
                        regenerateInputHints();
                      return;
                    }
                    // Intercept navigation keys when the menu is open (not during IME composition); don't let them bubble to send.
                    if (slashOpen && !e.nativeEvent.isComposing) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setSlashSelected((s) => (s + 1) % slashCommands.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setSlashSelected(
                          (s) =>
                            (s - 1 + slashCommands.length) %
                            slashCommands.length,
                        );
                        return;
                      }
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const c = slashCommands[slashSelected];
                        if (c) completeSlashCommand(c);
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const c = slashCommands[slashSelected];
                        if (c) activateSlashCommand(c);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setSlashDismissed(true);
                        return;
                      }
                    }
                    // Esc stops an in-flight reply (the slash menu's own Esc is handled above and
                    // stops propagation, so it wins while the menu is open).
                    if (
                      e.key === "Escape" &&
                      !e.nativeEvent.isComposing &&
                      replyBusy &&
                      stoppable
                    ) {
                      e.preventDefault();
                      stopGenerating();
                      return;
                    }
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      !replyBusy
                    ) {
                      e.preventDefault();
                      submitInput();
                    }
                  }}
                  rows={1}
                  placeholder={
                    lessonGateActive
                      ? t("chat.lessonStartHint")
                      : learningMode
                        ? t("chat.inputPlaceholderLesson")
                        : drillDraftActive
                          ? drillDraft?.setup === "topic"
                            ? t("drill.themePlaceholder")
                            : t("drill.startHint")
                          : isDictation
                            ? dictationAwaitingEnter
                              ? t("dictation.awaitingEnterPlaceholder")
                              : t("dictation.transcriptionPlaceholder")
                            : redoActive
                              ? t("chat.redoPlaceholder")
                              : !compact && inputHints && inputHints.length > 0
                                ? "" // hint shown via the animated overlay below
                                : t("chat.inputPlaceholderPractice")
                  }
                  disabled={
                    lessonGateActive ||
                    (drillDraftActive && drillDraft?.setup !== "topic")
                  }
                  className="max-h-[6.5rem] min-h-14 w-full min-w-0 resize-none border-none bg-transparent px-4 pt-3 pb-2 text-ui-chat outline-none placeholder:text-muted-foreground"
                />
                {hintsActive && (
                  <div
                    ref={hintOverlayRef}
                    className="pointer-events-none absolute inset-0 overflow-hidden px-4 pt-3 text-ui-chat"
                  >
                    <span
                      key={inputHints?.[0]}
                      className="animate-hint-in line-clamp-3 pr-7 text-muted-foreground"
                    >
                      {inputHints?.[0]}
                    </span>
                    <button
                      type="button"
                      onClick={regenerateInputHints}
                      disabled={hintRegenerating}
                      title={actionShortcutTitle(
                        t("coach.hints.regenerate"),
                        "refresh-hints",
                      )}
                      aria-label={t("coach.hints.regenerate")}
                      aria-keyshortcuts={actionAriaKeyshortcuts(
                        "refresh-hints",
                      )}
                      className="pointer-events-auto absolute top-2.5 right-2 rounded p-1 text-ui-muted transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCwIcon
                        size={13}
                        className={
                          hintRegenerating ? "animate-spin" : undefined
                        }
                      />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex min-h-11 items-end gap-2 px-2 pt-1 pb-2">
                <div
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                  title={compact ? undefined : contextTitle}
                >
                  {!compact &&
                    optionBadges.map((b) => (
                      <span
                        key={b.label}
                        className={`inline-flex max-w-32 items-center truncate rounded-md px-1.5 py-0.5 text-ui-caption font-medium ${
                          b.tone === "info"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-ui-muted"
                        }`}
                      >
                        {b.label}
                      </span>
                    ))}
                  {showContextWarning && (
                    <span
                      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-ui-caption font-semibold tabular-nums ${
                        usedPercent >= 90
                          ? "bg-destructive/10 text-destructive"
                          : "bg-warning/10 text-warning"
                      }`}
                      title={contextTitle}
                    >
                      {usedPercent}%
                    </span>
                  )}
                </div>
                <Select
                  value={selectedModelValue}
                  onValueChange={selectModelProvider}
                  disabled={replyBusy || isDraft}
                >
                  <SelectTrigger
                    className="h-8 w-auto min-w-[5.5rem] max-w-[min(42vw,12rem)] gap-1.5 rounded-full border-0 bg-transparent px-2 py-0 font-normal leading-none text-ui-muted shadow-none hover:bg-accent focus-visible:ring-0 sm:max-w-[14rem] [&>svg]:size-2.5"
                    aria-label={t("chat.selectModel")}
                    title={
                      conversationModelOverride
                        ? `${t("chat.sessionModel")} · ${currentProviderModelLabel}`
                        : `${t("chat.settingsDefaultModel")} · ${currentProviderModelLabel}`
                    }
                  >
                    <ModelLogo model={active.model} compact />
                    <span className="min-w-0 truncate text-ui-meta">
                      {currentModelButtonLabel}
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    side="top"
                    align="end"
                    sideOffset={6}
                    className="w-80 max-w-[min(92vw,24rem)]"
                  >
                    <SelectItem value={SETTINGS_DEFAULT_MODEL_VALUE}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ModelLogo model={defaultModelSelection.model} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">
                            {t("chat.settingsDefaultModel")}
                          </span>
                          <span className="truncate text-ui-caption text-ui-muted">
                            {providerModelLabel(
                              defaultModelSelection.providerType,
                              defaultModelSelection.model,
                            )}
                          </span>
                        </span>
                      </span>
                    </SelectItem>
                    {selectedModelValue === CURRENT_MODEL_VALUE && (
                      <SelectItem value={CURRENT_MODEL_VALUE}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <ModelLogo model={active.model} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">
                              {currentModelOption?.label ||
                                currentModelButtonLabel}
                            </span>
                            <span className="truncate text-ui-caption text-ui-muted">
                              {conversationModelOverride
                                ? t("chat.sessionModel")
                                : currentPreset.shortLabel}{" "}
                              · {active.model.trim() || t("chat.emptyModelId")}
                            </span>
                          </span>
                        </span>
                      </SelectItem>
                    )}
                    {MODEL_PROVIDERS.map((providerType) => {
                      const preset = PROVIDER_PRESETS[providerType];
                      const models = isOAuthProvider(providerType)
                        ? preset.models
                        : providerModels(
                            providerType,
                            config.providers[providerType],
                          );
                      return models.map((model) => (
                        <SelectItem
                          key={`${providerType}:${model.model}`}
                          value={modelSelectValue(providerType, model.model)}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <ModelLogo model={model.model} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate">{model.label}</span>
                              <span className="truncate text-ui-caption text-ui-muted">
                                {preset.shortLabel} · {model.model}
                              </span>
                            </span>
                          </span>
                        </SelectItem>
                      ));
                    })}
                  </SelectContent>
                </Select>
                <MicButton
                  disabled={
                    replyBusy ||
                    lessonGateActive ||
                    (drillDraftActive && drillDraft?.setup !== "topic") ||
                    (isSayDrill && dictationAwaitingEnter)
                  }
                  onPartial={(live) => {
                    setInput((cur) => {
                      if (sttBaseRef.current === null) {
                        sttBaseRef.current = cur.trim()
                          ? `${cur.trimEnd()} `
                          : "";
                      }
                      return sttBaseRef.current + live;
                    });
                  }}
                  onTranscript={(text) => {
                    setInput((cur) => {
                      const base = sttBaseRef.current;
                      sttBaseRef.current = null;
                      if (base !== null) {
                        return text ? base + text : base.trimEnd();
                      }
                      if (!text) return cur;
                      return cur.trim() ? `${cur.trimEnd()} ${text}` : text;
                    });
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  onError={showError}
                />
                {replyBusy && stoppable ? (
                  <Button
                    type="button"
                    size="icon"
                    onClick={stopGenerating}
                    className="size-8 rounded-full transition-transform active:scale-90"
                    title={`${t("chat.stopGenerating")} ${actionShortcutLabel("stop-generating")}`}
                    aria-label={t("chat.stopGenerating")}
                  >
                    <SquareIcon className="size-3 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    className="size-8 rounded-full transition-transform active:scale-90"
                    disabled={
                      replyBusy ||
                      lessonGateActive ||
                      (drillDraftActive && drillDraft?.setup !== "topic") ||
                      !input.trim() ||
                      (isSayDrill && dictationAwaitingEnter)
                    }
                    title={`${t("chat.send")} ${actionShortcutLabel("send")}`}
                    aria-label={t("chat.send")}
                  >
                    {replyBusy ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <ArrowUpIcon className="size-4" />
                    )}
                  </Button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
