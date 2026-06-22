import {
  CheckIcon,
  EarIcon,
  GaugeIcon,
  LanguagesIcon,
  LightbulbIcon,
  PencilLineIcon,
  PlayIcon,
  RotateCcwIcon,
  Settings2Icon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@/i18n";
import {
  actionAriaKeyshortcuts,
  actionKeyCaps,
  matchesActionShortcut,
  useKeybindings,
} from "@/lib/app-actions";
import { cn } from "@/lib/utils";
import { getAppState, setAppState } from "../db/app-state";
import type { ConversationMeta } from "../db/conversations";
import { loadChatHistory } from "../db/turns";
import {
  buildConversationItems,
  type ListeningItem,
  type ListeningSide,
} from "../tts/listening";
import {
  pauseSpeech,
  playSpeech,
  resumeSpeech,
  setSpeechRate,
  stopSpeech,
} from "../tts/playback";
import { speakText } from "../tts/speak";
import { ConversationPickerPopover } from "./ConversationPicker";
import { checkDictation, type DictationResult } from "./dictation-diff";
import {
  createEmptyDictationProgress,
  DICTATION_PROGRESS_KEY,
  type DictationPromptMode,
  findNextUnmasteredItem,
  getDictationCursor,
  isDictationMastered,
  parseDictationProgress,
  recordDictationAttempt,
  selectionKey,
  setDictationCursor,
} from "./dictation-progress";
import {
  segmentDictationSentences,
  toDictationPlainText,
} from "./dictation-text";
import {
  NO_PROVIDER,
  prefetchPromptTranslations,
  translateForPrompt,
} from "./dictation-translate";
import { type ProviderKind, ProviderStatus } from "./ProviderStatus";
import { SpeakButton } from "./SpeakButton";
import { AnchoredPopover } from "./ui/anchored-popover";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";
import { applyDictationHint, WordSlotsInput } from "./WordSlotsInput";

const STORAGE_KEY = "lang-agent.dictation-review";
// How many recent conversations to pre-select the first time, so the page is usable on open.
const DEFAULT_RECENT = 20;
const MEANING_PREFETCH_COUNT = 6;

interface PersistedState {
  selectedIds: string[];
  /** False until the learner edits the conversation selection — while false we default to recents. */
  customized: boolean;
  mode: DictationPromptMode;
  /** Which line types are dictated. */
  includeAi: boolean;
  includeUser: boolean;
  /** Speak the current line automatically when it appears (by-ear mode only). */
  autoplay: boolean;
}

const DEFAULTS: PersistedState = {
  selectedIds: [],
  customized: false,
  mode: "audio",
  includeAi: true,
  includeUser: true,
  autoplay: true,
};

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedState>) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Manual + automatic playback for the current line. Mirrors DictationReply's ReplayControls: every
// call speaks the EXACT line text with no voice override, so it is served from the same IndexedDB TTS
// cache the chat filled (instant, offline). A generation guard drops state updates from a playback
// that was superseded (rapid replay / advancing lines).
function useDictationAudio() {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState<1 | 0.75>(1);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);
  const rateRef = useRef<1 | 0.75>(1);

  const play = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const gen = ++genRef.current;
    setLoading(true);
    setPlaying(false);
    setPaused(false);
    setError(null);
    try {
      stopSpeech();
      const audio = await speakText(text);
      if (gen !== genRef.current) return;
      setLoading(false);
      setPlaying(true);
      await playSpeech(audio, text, { rate: rateRef.current });
      if (gen !== genRef.current) return;
      setPlaying(false);
      setPaused(false);
    } catch (e) {
      if (gen !== genRef.current) return;
      setLoading(false);
      setPlaying(false);
      setPaused(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const pause = useCallback(() => {
    if (!playing) return;
    pauseSpeech();
    setPlaying(false);
    setPaused(true);
  }, [playing]);

  const resume = useCallback(() => {
    if (!paused) return;
    resumeSpeech();
    setPaused(false);
    setPlaying(true);
  }, [paused]);

  const toggle = useCallback(
    (text: string) => {
      if (loading) return;
      if (playing) {
        pause();
      } else if (paused) {
        resume();
      } else {
        void play(text);
      }
    },
    [loading, pause, paused, play, playing, resume],
  );

  const stop = useCallback(() => {
    genRef.current++;
    stopSpeech();
    setLoading(false);
    setPlaying(false);
    setPaused(false);
  }, []);

  const toggleRate = useCallback(() => {
    setRate((current) => {
      const next = current === 1 ? 0.75 : 1;
      rateRef.current = next;
      setSpeechRate(next);
      return next;
    });
  }, []);

  return {
    play,
    toggle,
    toggleRate,
    stop,
    loading,
    playing,
    paused,
    rate,
    error,
  };
}

function PlaybackGlyph({
  loading,
  playing,
  paused,
  large = false,
}: {
  loading: boolean;
  playing: boolean;
  paused: boolean;
  large?: boolean;
}) {
  if (loading) return <Spinner className={large ? "size-7" : "size-3.5"} />;
  if (playing)
    return (
      <span className={large ? "scale-150" : ""}>
        <span className="speak-bars" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </span>
    );
  if (paused)
    return (
      <PlayIcon
        className={large ? "size-8 translate-x-0.5" : "size-4 translate-x-px"}
      />
    );
  return <Volume2Icon className={large ? "size-8" : "size-4"} />;
}

function PlaybackSpeedButton({
  rate,
  onToggle,
}: {
  rate: 1 | 0.75;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={rate < 1}
      aria-label={t("dictationReview.playbackSpeed")}
      title={t("dictationReview.playbackSpeed")}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors",
        rate < 1
          ? "bg-primary/10 text-primary"
          : "text-ui-muted hover:bg-accent hover:text-foreground",
      )}
    >
      <GaugeIcon className="size-3.5" />
      {rate === 1 ? "1×" : "0.75×"}
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[0.6875rem] leading-none text-ui-muted">
      {children}
    </kbd>
  );
}

// One "⌘'  Play" style hint: the chord caps (OS-adaptive, from the app's keybinding settings) + a label.
function ShortcutHint({ caps, label }: { caps: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1">
        {caps.map((cap, i) => (
          <Kbd key={`${i}-${cap}`}>{cap}</Kbd>
        ))}
      </span>
      {label}
    </span>
  );
}

// One label/control row inside the settings popover.
function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2.5 last:border-0">
      <span className="text-ui-body text-foreground">{label}</span>
      {children}
    </div>
  );
}

// Content + playback options, tucked into a gear so the practice surface stays focused.
function SettingsPopover({
  mode,
  includeAi,
  setIncludeAi,
  includeUser,
  setIncludeUser,
  autoplay,
  setAutoplay,
}: {
  mode: DictationPromptMode;
  includeAi: boolean;
  setIncludeAi: (v: boolean) => void;
  includeUser: boolean;
  setIncludeUser: (v: boolean) => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("dictationReview.settingsLabel")}
        title={t("dictationReview.settingsLabel")}
        className="inline-flex size-9 items-center justify-center rounded-md border text-ui-muted transition-colors hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
        data-active={open}
      >
        <Settings2Icon className="size-4" />
      </button>
      <AnchoredPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={256}
        className="overflow-y-auto rounded-lg border bg-popover px-3 text-popover-foreground shadow-minimal"
      >
        <div className="border-b py-2 text-ui-caption font-medium text-ui-muted">
          {t("dictationReview.contentLabel")}
        </div>
        <SettingRow label={t("dictationReview.typeAi")}>
          <Switch checked={includeAi} onCheckedChange={setIncludeAi} />
        </SettingRow>
        <SettingRow label={t("dictationReview.typeUser")}>
          <Switch checked={includeUser} onCheckedChange={setIncludeUser} />
        </SettingRow>
        {mode === "audio" && (
          <SettingRow label={t("dictationReview.autoplay")}>
            <Switch checked={autoplay} onCheckedChange={setAutoplay} />
          </SettingRow>
        )}
      </AnchoredPopover>
    </div>
  );
}

export function DictationReviewView({
  conversations,
  onOpenProviderSettings,
}: {
  conversations: ConversationMeta[];
  onOpenProviderSettings?: (kind: ProviderKind) => void;
}) {
  const { t } = useTranslation();
  // Subscribe so the on-screen shortcut hints re-render when a chord is remapped in settings.
  useKeybindings();
  const initial = useRef(loadPersisted()).current;
  const [selectedIds, setSelectedIds] = useState<string[]>(initial.selectedIds);
  const [customized, setCustomized] = useState(initial.customized);
  const [mode, setMode] = useState<DictationPromptMode>(initial.mode);
  const [includeAi, setIncludeAi] = useState(initial.includeAi);
  const [includeUser, setIncludeUser] = useState(initial.includeUser);
  const [autoplay, setAutoplay] = useState(initial.autoplay);

  const [itemsByConv, setItemsByConv] = useState<
    Record<string, ListeningItem[]>
  >({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const loadingRef = useRef(new Set<string>());

  const [progress, setProgress] = useState(createEmptyDictationProgress);
  const [progressReady, setProgressReady] = useState(false);

  // Per-question state. The stable item id is the cursor; source-array indices can shift as
  // conversations are filtered or already-mastered lines are removed from the training queue.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<DictationResult | null>(null);
  const [usedHint, setUsedHint] = useState(false);
  // By-meaning prompt (the native-language sentence the learner reproduces).
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const {
    play,
    toggle: toggleAudio,
    toggleRate,
    stop,
    loading,
    playing,
    paused,
    rate,
    error,
  } = useDictationAudio();
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Attempt history and cursors are continuity data, so they live in SQLite app_state and travel
  // with normal backups. Plain-browser development can run without the database.
  useEffect(() => {
    let cancelled = false;
    getAppState(DICTATION_PROGRESS_KEY)
      .then((raw) => {
        if (!cancelled) setProgress(parseDictationProgress(raw));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProgressReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!progressReady) return;
    void setAppState(DICTATION_PROGRESS_KEY, JSON.stringify(progress)).catch(
      () => {},
    );
  }, [progress, progressReady]);

  // The most recently active conversations — the default selection until the learner picks their own.
  const recentIds = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, DEFAULT_RECENT)
        .map((c) => c.id),
    [conversations],
  );

  // Until the learner edits the selection, follow the recents (so the page is never empty on open).
  useEffect(() => {
    if (!customized && recentIds.length > 0) setSelectedIds(recentIds);
  }, [customized, recentIds]);

  // Persist player settings + the chosen playlist across navigation.
  useEffect(() => {
    const state: PersistedState = {
      selectedIds,
      customized,
      mode,
      includeAi,
      includeUser,
      autoplay,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [selectedIds, customized, mode, includeAi, includeUser, autoplay]);

  // Drop selections whose conversation has since been deleted.
  useEffect(() => {
    setSelectedIds((prev) => {
      const live = prev.filter((id) => conversations.some((c) => c.id === id));
      return live.length === prev.length ? prev : live;
    });
  }, [conversations]);

  // Lazily load + extract lines for each newly selected conversation (same source as the listening view).
  useEffect(() => {
    for (const id of selectedIds) {
      if (itemsByConv[id] || loadingRef.current.has(id)) continue;
      loadingRef.current.add(id);
      setLoadingIds(new Set(loadingRef.current));
      void loadChatHistory(id, 500)
        .then((turns) => {
          const conv = conversations.find((c) => c.id === id);
          const items = conv ? buildConversationItems(conv, turns) : [];
          setItemsByConv((prev) => ({ ...prev, [id]: items }));
        })
        .catch(() => setItemsByConv((prev) => ({ ...prev, [id]: [] })))
        .finally(() => {
          loadingRef.current.delete(id);
          setLoadingIds(new Set(loadingRef.current));
        });
    }
  }, [selectedIds, conversations, itemsByConv]);

  const includes = useCallback(
    (side: ListeningSide) => (side === "ai" ? includeAi : includeUser),
    [includeAi, includeUser],
  );

  // The source queue: selected conversations' lines, filtered to the enabled types, in order.
  const items = useMemo(
    () =>
      selectedIds
        .flatMap((id) => itemsByConv[id] ?? [])
        .filter((it) => includes(it.side))
        .flatMap((item) => {
          const segments = segmentDictationSentences(
            toDictationPlainText(item.text),
          );
          const split = segments.length > 1;
          return segments.map((text, i) => ({
            ...item,
            id: split ? `${item.id}#${i}` : item.id,
            text,
            nativePrompt: split ? undefined : item.nativePrompt,
          }));
        })
        .filter((item) => item.text.length > 0),
    [selectedIds, itemsByConv, includes],
  );

  const selectedKey = useMemo(() => selectionKey(selectedIds), [selectedIds]);
  const cursorScope = `${selectedKey}:${mode}`;
  const queueReady =
    progressReady && selectedIds.every((id) => itemsByConv[id] !== undefined);
  const current = currentId
    ? items.find((item) => item.id === currentId)
    : undefined;
  const answered = result !== null;
  const cursorScopeRef = useRef<string | null>(null);

  // Restore the saved line once the complete selected queue has loaded. A changed conversation
  // selection or prompt mode gets its own cursor; mastered lines are never restored in that mode.
  useEffect(() => {
    if (!queueReady) return;
    const scopeChanged = cursorScopeRef.current !== cursorScope;
    if (scopeChanged) {
      cursorScopeRef.current = cursorScope;
      stop();
      setInput("");
      setResult(null);
      setUsedHint(false);
    }

    const active = currentId
      ? items.find((item) => item.id === currentId)
      : null;
    if (
      !scopeChanged &&
      active &&
      (answered || !isDictationMastered(progress, active.id, mode))
    ) {
      return;
    }

    const savedId = getDictationCursor(progress, selectedKey, mode);
    const saved =
      items.find((item) => item.id === savedId) &&
      savedId &&
      !isDictationMastered(progress, savedId, mode)
        ? savedId
        : null;
    const fallback = findNextUnmasteredItem(items, null, progress, mode, 1);
    const nextId = saved ?? fallback?.id ?? null;
    setCurrentId(nextId);
    if (
      scopeChanged &&
      nextId === currentId &&
      mode === "audio" &&
      autoplayRef.current
    ) {
      const next = items.find((item) => item.id === nextId);
      if (next) void play(next.text);
    }
  }, [
    answered,
    currentId,
    cursorScope,
    items,
    mode,
    progress,
    play,
    queueReady,
    selectedKey,
    stop,
  ]);

  // A new line came into focus (advance, jump, or filter shift): clear the answer; in by-ear mode
  // autoplay it (never in by-meaning mode — that would give the answer away).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the line id — reset+play once per line, not on every play() identity change.
  useEffect(() => {
    setInput("");
    setResult(null);
    setUsedHint(false);
    if (current && modeRef.current === "audio" && autoplayRef.current)
      void play(current.text);
  }, [current?.id]);

  // By-meaning mode should not make every next card wait on translation. Keep a small lookahead buffer
  // warm; the translation module dedupes with the current-card request and caches successful results.
  useEffect(() => {
    if (mode !== "meaning" || !queueReady || !current) return;
    const start = items.findIndex((item) => item.id === current.id);
    if (start < 0) return;
    const sentences: string[] = [];
    for (
      let step = 0;
      step < items.length && sentences.length < MEANING_PREFETCH_COUNT;
      step++
    ) {
      const item = items[(start + step) % items.length];
      if (
        item.nativePrompt ||
        isDictationMastered(progress, item.id, "meaning")
      )
        continue;
      sentences.push(item.text);
    }
    if (sentences.length > 0) void prefetchPromptTranslations(sentences);
  }, [current, items, mode, progress, queueReady]);

  // Resolve native-language text when it is the prompt, or after an audio answer so the reveal can
  // include the meaning. Expression-gap lines already carry their native source; other lines are
  // translated on demand and cached.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on mode + answer step + line id.
  useEffect(() => {
    if ((mode !== "meaning" && !answered) || !current) {
      setPromptText(null);
      setPromptLoading(false);
      setPromptError(null);
      return;
    }
    if (current.nativePrompt) {
      setPromptText(current.nativePrompt);
      setPromptLoading(false);
      setPromptError(null);
      return;
    }
    let cancelled = false;
    setPromptText(null);
    setPromptError(null);
    setPromptLoading(true);
    translateForPrompt(current.text)
      .then((tx) => {
        if (!cancelled) setPromptText(tx);
      })
      .catch((e) => {
        if (cancelled) return;
        setPromptError(
          e instanceof Error && e.message === NO_PROVIDER
            ? t("dictationReview.translateNeedsLlm")
            : t("dictationReview.translateFailed"),
        );
      })
      .finally(() => {
        if (!cancelled) setPromptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, answered, current?.id]);

  // Drive focus for the current step: the input while typing, the Next button once answered (so Enter
  // advances). Keyed on `answered` too, so it lands on the input only after the textarea re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the line id, not the current object identity — focus once per line/step.
  useEffect(() => {
    if (answered) nextRef.current?.focus();
    else if (current) inputRef.current?.focus();
  }, [answered, current?.id]);

  function check() {
    if (!current || answered) return;
    stop();
    const nextResult = checkDictation(current.text, input);
    setResult(nextResult);
    if (!usedHint || !nextResult.correct) {
      setProgress((previous) =>
        recordDictationAttempt(previous, current.id, mode, nextResult.correct),
      );
    }
  }

  function revealHint() {
    if (!current || answered) return;
    const nextInput = applyDictationHint(input, current.text);
    if (nextInput === null) return;
    setInput(nextInput);
    setUsedHint(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function retryCurrent() {
    if (!current || result?.correct !== false) return;
    stop();
    setInput("");
    setResult(null);
    setUsedHint(false);
    if (mode === "audio") void play(current.text);
  }

  function go(delta: -1 | 1) {
    if (!current) return;
    stop();
    const next = findNextUnmasteredItem(
      items,
      current.id,
      progress,
      mode,
      delta,
    );
    setInput("");
    setResult(null);
    setUsedHint(false);
    setCurrentId(next?.id ?? null);
    setProgress((previous) =>
      setDictationCursor(previous, selectedKey, mode, next?.id ?? null),
    );
    if (next?.id === current.id && mode === "audio" && autoplayRef.current) {
      void play(next.text);
    }
  }

  // Latest-state shortcut actions, read by the window listener (avoids stale closures over input).
  const actionsRef = useRef({
    check: () => {},
    hint: () => {},
    playCurrent: () => {},
  });
  actionsRef.current = {
    check,
    hint: revealHint,
    playCurrent: () => {
      if (current) toggleAudio(current.text);
    },
  };

  // View shortcuts via the app's keybinding system (OS-adaptive + user-remappable): play the line and
  // reveal the answer. Enter (submit) is handled on the input. Attached once; matching reads the live
  // binding at event time, and the actions are read from a ref to avoid stale closures over input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (matchesActionShortcut(e, "dictation-play")) {
        e.preventDefault();
        actionsRef.current.playCurrent();
      } else if (matchesActionShortcut(e, "dictation-hint")) {
        e.preventDefault();
        actionsRef.current.hint();
      } else if (matchesActionShortcut(e, "dictation-reveal")) {
        e.preventDefault();
        actionsRef.current.check();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Stop audio when leaving the view.
  useEffect(() => () => stop(), [stop]);

  const sideLabel = (side: ListeningSide) =>
    side === "ai" ? t("listening.sideAi") : t("listening.sideUser");

  function pickConversations(ids: string[]) {
    setCustomized(true);
    setSelectedIds(ids);
  }

  function toggleConv(id: string) {
    pickConversations(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Let the IME consume Enter while composing a CJK candidate (don't submit mid-composition).
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      check();
    }
  }

  const queueLoading = selectedIds.length > 0 && !queueReady;
  const hasItems = current !== undefined;
  // Progress is now measured by mastery (answered-correct lines), not cursor position: the queue keeps
  // mastered lines but skips them, so a position counter would jump around and never complete.
  const masteredCount = items.filter((item) =>
    isDictationMastered(progress, item.id, mode),
  ).length;
  const allMastered =
    queueReady && items.length > 0 && masteredCount === items.length;
  const missCount =
    result?.expectedTokens.filter((tk) => tk.status === "miss").length ?? 0;
  const resultWordCount = result?.expectedTokens.length ?? 0;
  const hintAvailable =
    current && !answered
      ? applyDictationHint(input, current.text) !== null
      : false;
  const convTitle = current
    ? (conversations.find((c) => c.id === current.conversationId)?.title ?? "")
    : "";

  const sourceBadge = current && (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 font-medium",
        current.side === "user"
          ? "bg-primary/10 text-primary"
          : "bg-accent text-foreground",
      )}
    >
      {sideLabel(current.side)}
    </span>
  );

  const sourceChip = current && (
    <span className="flex min-w-0 items-center gap-1.5">
      {sourceBadge}
      <span className="max-w-40 truncate">{convTitle}</span>
    </span>
  );

  const audioPromptSource = current && (
    <span className="flex min-w-0 items-center">{sourceBadge}</span>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden px-6 pt-4 pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        {/* Header: title, prompt mode, source picker and settings share one compact row. */}
        <div className="flex shrink-0 flex-col gap-3">
          <ProviderStatus onOpen={onOpenProviderSettings} kinds={["tts"]} />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 items-center gap-4">
              <h2 className="m-0 flex shrink-0 items-center gap-2.5 text-ui-title font-semibold">
                <PencilLineIcon className="size-6 shrink-0 text-primary" />
                {t("dictationReview.title")}
              </h2>
              <div className="inline-flex shrink-0 rounded-md bg-muted p-0.5 text-ui-caption">
                {(["audio", "meaning"] as const).map((m) => {
                  const ModeIcon = m === "audio" ? EarIcon : LanguagesIcon;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      data-active={mode === m}
                      className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium text-ui-muted transition-colors data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-minimal-flat"
                    >
                      <ModeIcon className="size-3.5" />
                      {m === "audio"
                        ? t("dictationReview.modeAudio")
                        : t("dictationReview.modeMeaning")}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ConversationPickerPopover
                conversations={conversations}
                selectedIds={selectedIds}
                itemsByConv={itemsByConv}
                loadingIds={loadingIds}
                onToggle={toggleConv}
                onSelectAll={() =>
                  pickConversations(conversations.map((c) => c.id))
                }
                onClear={() => pickConversations([])}
              />
              <SettingsPopover
                mode={mode}
                includeAi={includeAi}
                setIncludeAi={setIncludeAi}
                includeUser={includeUser}
                setIncludeUser={setIncludeUser}
                autoplay={autoplay}
                setAutoplay={setAutoplay}
              />
            </div>
          </div>
        </div>

        {queueLoading ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : !hasItems ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            {allMastered ? (
              <CheckIcon className="mb-3 size-9 text-success" />
            ) : (
              <PencilLineIcon className="mb-3 size-9 text-ui-muted" />
            )}
            <p className="m-0 text-ui-body text-foreground">
              {selectedIds.length === 0
                ? t("dictationReview.noSelection")
                : allMastered
                  ? t("dictationReview.allDone")
                  : t("dictationReview.noItems")}
            </p>
            <p className="m-0 mt-1 max-w-sm text-ui-caption text-ui-muted">
              {allMastered
                ? t("dictationReview.allDoneHint")
                : t("dictationReview.noSelectionHint")}
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Stage — the active question. Top-anchored (not centred) so the prompt stays put as the
                answer grows across lines; the area scrolls if a long prompt + answer overflow. */}
            <div className="flex min-h-0 flex-1 flex-col items-center gap-7 overflow-y-auto px-2 pt-9 pb-6">
              {!answered ? (
                <>
                  {mode === "audio" ? (
                    /* By ear — the play button is the hero */
                    <div className="flex flex-col items-center gap-4">
                      <button
                        type="button"
                        onClick={() => current && toggleAudio(current.text)}
                        aria-label={
                          playing
                            ? t("dictationReview.pausePronunciation")
                            : paused
                              ? t("dictationReview.resumePronunciation")
                              : t("dictationReview.playPronunciation")
                        }
                        title={
                          playing
                            ? t("dictationReview.pausePronunciation")
                            : paused
                              ? t("dictationReview.resumePronunciation")
                              : t("dictationReview.playPronunciation")
                        }
                        className="relative inline-flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-minimal transition-transform hover:scale-105 active:scale-95"
                      >
                        <PlaybackGlyph
                          loading={loading}
                          playing={playing}
                          paused={paused}
                          large
                        />
                      </button>
                      <div className="flex items-center gap-3 text-ui-caption text-ui-muted">
                        <PlaybackSpeedButton
                          rate={rate}
                          onToggle={toggleRate}
                        />
                        {audioPromptSource}
                      </div>
                    </div>
                  ) : (
                    /* By meaning — the native-language prompt is the hero, audio is an optional hint */
                    <div className="flex w-full flex-col items-center gap-4">
                      {promptLoading ? (
                        <Spinner className="size-6" />
                      ) : promptError ? (
                        <p className="m-0 max-w-sm text-center text-ui-body text-destructive">
                          {promptError}
                        </p>
                      ) : (
                        <p className="m-0 text-pretty text-center text-2xl font-semibold leading-relaxed text-foreground">
                          {promptText}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-ui-caption text-ui-muted">
                        <button
                          type="button"
                          onClick={() => current && toggleAudio(current.text)}
                          aria-label={
                            playing
                              ? t("dictationReview.pausePronunciation")
                              : paused
                                ? t("dictationReview.resumePronunciation")
                                : t("dictationReview.playPronunciation")
                          }
                          title={
                            playing
                              ? t("dictationReview.pausePronunciation")
                              : paused
                                ? t("dictationReview.resumePronunciation")
                                : t("dictationReview.playPronunciation")
                          }
                          className="inline-flex size-8 items-center justify-center rounded-full text-primary transition-colors hover:bg-accent"
                        >
                          <PlaybackGlyph
                            loading={loading}
                            playing={playing}
                            paused={paused}
                          />
                        </button>
                        <PlaybackSpeedButton
                          rate={rate}
                          onToggle={toggleRate}
                        />
                        {sourceChip}
                      </div>
                    </div>
                  )}

                  {/* Transcribe — target-sized underlines hint at each word's length */}
                  <WordSlotsInput
                    ref={inputRef}
                    value={input}
                    onChange={setInput}
                    onKeyDown={onInputKeyDown}
                    targetText={current.text}
                    ariaLabel={
                      mode === "meaning"
                        ? t("dictationReview.inputPlaceholderMeaning")
                        : t("dictationReview.inputPlaceholder")
                    }
                  />
                </>
              ) : (
                /* Reveal — page content, not a nested card. */
                <div className="flex w-full shrink-0 animate-in flex-col items-center gap-7 fade-in-0 slide-in-from-bottom-2 duration-300">
                  <div className="flex w-full items-center justify-between gap-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-ui-caption font-medium",
                        result?.correct
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {result?.correct && <CheckIcon className="size-3.5" />}
                      {result?.correct
                        ? t("dictationReview.correct")
                        : t("dictationReview.missedWords", { n: missCount })}
                    </span>
                    <div className="flex min-w-0 items-center gap-2 text-ui-caption text-ui-muted">
                      {sourceChip}
                      <SpeakButton text={current.text} variant="round" />
                    </div>
                  </div>

                  <p
                    className={cn(
                      "m-0 max-w-3xl text-pretty text-center font-medium leading-relaxed text-foreground",
                      resultWordCount > 18 ? "text-xl" : "text-2xl",
                    )}
                  >
                    {result?.expectedTokens.map((tk, i) => (
                      <span
                        key={`${i}-${tk.text}`}
                        className={cn(
                          tk.status === "miss" &&
                            "rounded-md bg-destructive/12 px-1 py-0.5 text-destructive",
                        )}
                      >
                        {tk.text}
                        {i < (result?.expectedTokens.length ?? 0) - 1
                          ? " "
                          : ""}
                      </span>
                    ))}
                  </p>

                  {promptLoading ? (
                    <Spinner className="size-4 text-ui-muted" />
                  ) : promptText ? (
                    <div className="flex max-w-xl flex-col items-center gap-1.5 text-center">
                      <span className="text-ui-caption font-medium text-ui-muted">
                        {t("dictationReview.translation")}
                      </span>
                      <p className="m-0 text-pretty text-ui-body leading-relaxed text-ui-muted">
                        {promptText}
                      </p>
                    </div>
                  ) : promptError ? (
                    <p className="m-0 max-w-sm text-center text-ui-caption text-destructive">
                      {promptError}
                    </p>
                  ) : null}

                  {!result?.correct && input.trim() && (
                    <div className="w-full pt-1">
                      <p className="m-0 text-ui-caption font-medium text-ui-muted">
                        {t("dictationReview.yourAnswer")}
                      </p>
                      <p className="m-0 mt-1 break-words text-ui-body leading-relaxed text-foreground">
                        {input}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui-caption text-destructive"
                  role="alert"
                >
                  <span className="min-w-0 flex-1">{error}</span>
                </div>
              )}
            </div>

            {/* Transport */}
            <div className="grid shrink-0 grid-cols-3 items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => go(-1)}
                className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-md px-3 text-ui-body text-ui-muted transition-colors hover:bg-accent hover:text-foreground"
              >
                <SkipBackIcon className="size-4" />
                {t("dictationReview.prev")}
              </button>
              {!answered ? (
                <div className="flex items-center gap-2 justify-self-center">
                  <button
                    type="button"
                    onClick={revealHint}
                    disabled={!hintAvailable}
                    aria-keyshortcuts={actionAriaKeyshortcuts("dictation-hint")}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-ui-body font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                  >
                    <LightbulbIcon className="size-4" />
                    {t("dictationReview.hint")}
                  </button>
                  <button
                    type="button"
                    onClick={check}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-5 text-ui-body font-medium text-primary-foreground shadow-minimal transition-colors hover:bg-primary/90"
                  >
                    <CheckIcon className="size-4" />
                    {t("dictationReview.check")}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 justify-self-center">
                  {result?.correct === false && (
                    <button
                      type="button"
                      onClick={retryCurrent}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-ui-body font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      <RotateCcwIcon className="size-4" />
                      {t("dictationReview.tryAgain")}
                    </button>
                  )}
                  <button
                    ref={nextRef}
                    type="button"
                    onClick={() => go(1)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-5 text-ui-body font-medium text-primary-foreground shadow-minimal transition-colors hover:bg-primary/90"
                  >
                    {t("dictationReview.next")}
                    <SkipForwardIcon className="size-4" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 justify-self-end">
                {hasItems && (
                  <span className="shrink-0 text-ui-caption tabular-nums text-ui-muted">
                    {masteredCount} / {items.length}
                  </span>
                )}
                {!answered && (
                  <button
                    type="button"
                    onClick={() => go(1)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-ui-body text-ui-muted transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {t("dictationReview.skip")}
                    <SkipForwardIcon className="size-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-ui-caption text-ui-muted">
              <ShortcutHint
                caps={actionKeyCaps("dictation-play")}
                label={t("dictationReview.playPronunciation")}
              />
              <ShortcutHint
                caps={actionKeyCaps("dictation-hint")}
                label={t("dictationReview.hint")}
              />
              <ShortcutHint caps={["↩"]} label={t("dictationReview.submit")} />
              <ShortcutHint
                caps={actionKeyCaps("dictation-reveal")}
                label={t("dictationReview.showAnswer")}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
