import {
  CheckIcon,
  PencilLineIcon,
  Settings2Icon,
  SkipBackIcon,
  SkipForwardIcon,
  SnailIcon,
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
  actionKeyCaps,
  matchesActionShortcut,
  useKeybindings,
} from "@/lib/app-actions";
import { cn } from "@/lib/utils";
import type { ConversationMeta } from "../db/conversations";
import { loadChatHistory } from "../db/turns";
import {
  buildConversationItems,
  type ListeningItem,
  type ListeningSide,
} from "../tts/listening";
import { playSpeech, stopSpeech } from "../tts/playback";
import { speakText } from "../tts/speak";
import { ConversationPickerPopover } from "./ConversationPicker";
import { checkDictation, type DictationResult } from "./dictation-diff";
import { NO_PROVIDER, translateForPrompt } from "./dictation-translate";
import { type ProviderKind, ProviderStatus } from "./ProviderStatus";
import { SpeakButton } from "./SpeakButton";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";
import { WordSlotsInput } from "./WordSlotsInput";

const STORAGE_KEY = "lang-agent.dictation-review";
// How many recent conversations to pre-select the first time, so the page is usable on open.
const DEFAULT_RECENT = 20;

// Prompt modality: hear the sentence (by ear) or read its native-language meaning (by meaning). The
// answer — typing the target sentence — and grading are identical; only the prompt differs.
type PromptMode = "audio" | "meaning";

interface PersistedState {
  selectedIds: string[];
  /** False until the learner edits the conversation selection — while false we default to recents. */
  customized: boolean;
  mode: PromptMode;
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
  const [loading, setLoading] = useState<"normal" | "slow" | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  const play = useCallback(async (text: string, kind: "normal" | "slow") => {
    if (!text.trim()) return;
    const gen = ++genRef.current;
    setLoading(kind);
    setError(null);
    try {
      stopSpeech();
      const audio = await speakText(text);
      if (gen !== genRef.current) return;
      setLoading(null);
      setPlaying(true);
      await playSpeech(audio, text, { rate: kind === "slow" ? 0.7 : 1 });
      if (gen !== genRef.current) return;
      setPlaying(false);
    } catch (e) {
      if (gen !== genRef.current) return;
      setLoading(null);
      setPlaying(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const stop = useCallback(() => {
    genRef.current++;
    stopSpeech();
    setLoading(null);
    setPlaying(false);
  }, []);

  return { play, stop, loading, playing, error };
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

// Small pill for a replay action (normal / slow). The big play button in by-ear mode and these pills
// all route through the same cached playback.
function ReplayPill({
  loading,
  onClick,
  label,
  icon,
}: {
  loading: boolean;
  onClick: () => void;
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors hover:bg-accent hover:text-foreground"
    >
      {loading ? <Spinner className="size-3" /> : icon}
      {label}
    </button>
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
  mode: PromptMode;
  includeAi: boolean;
  setIncludeAi: (v: boolean) => void;
  includeUser: boolean;
  setIncludeUser: (v: boolean) => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
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
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-64 rounded-lg border bg-popover px-3 text-popover-foreground shadow-minimal">
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
        </div>
      )}
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
  const [mode, setMode] = useState<PromptMode>(initial.mode);
  const [includeAi, setIncludeAi] = useState(initial.includeAi);
  const [includeUser, setIncludeUser] = useState(initial.includeUser);
  const [autoplay, setAutoplay] = useState(initial.autoplay);

  const [itemsByConv, setItemsByConv] = useState<
    Record<string, ListeningItem[]>
  >({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const loadingRef = useRef(new Set<string>());

  // Per-question state.
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<DictationResult | null>(null);
  // By-meaning prompt (the native-language sentence the learner reproduces).
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const { play, stop, loading, playing, error } = useDictationAudio();
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  const modeRef = useRef(mode);
  modeRef.current = mode;

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

  // The dictation queue: selected conversations' lines, filtered to the enabled types, in order.
  const items = useMemo(
    () =>
      selectedIds
        .flatMap((id) => itemsByConv[id] ?? [])
        .filter((it) => includes(it.side)),
    [selectedIds, itemsByConv, includes],
  );

  const current = items[index];
  const answered = result !== null;
  const currentRef = useRef(current);
  currentRef.current = current;

  // Keep the cursor in range when the queue shrinks (deselect / filter change).
  useEffect(() => {
    if (index >= items.length && items.length > 0) setIndex(0);
  }, [items.length, index]);

  // A new line came into focus (advance, jump, or filter shift): clear the answer; in by-ear mode
  // autoplay it (never in by-meaning mode — that would give the answer away).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the line id — reset+play once per line, not on every play() identity change.
  useEffect(() => {
    setInput("");
    setResult(null);
    if (current && modeRef.current === "audio" && autoplayRef.current)
      void play(current.text, "normal");
  }, [current?.id]);

  // Switching prompt modality restarts the current line cleanly (and re-plays in by-ear mode).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on mode; reads the latest line via ref.
  useEffect(() => {
    setInput("");
    setResult(null);
    stop();
    const cur = currentRef.current;
    if (mode === "audio" && cur && autoplayRef.current)
      void play(cur.text, "normal");
  }, [mode]);

  // Resolve the by-meaning prompt for the current line: free for expression-gap lines (native source
  // already on the item), translated on demand + cached otherwise. Cleared entirely in by-ear mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on mode + line id.
  useEffect(() => {
    if (mode !== "meaning" || !current) {
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
  }, [mode, current?.id]);

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
    setResult(checkDictation(current.text, input));
  }

  function go(delta: number) {
    const len = items.length;
    if (len === 0) return;
    stop();
    setIndex((i) => (i + delta + len) % len);
  }

  // Latest-state shortcut actions, read by the window listener (avoids stale closures over input).
  const actionsRef = useRef({ check: () => {}, playCurrent: () => {} });
  actionsRef.current = {
    check,
    playCurrent: () => {
      if (current) void play(current.text, "normal");
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

  const hasItems = items.length > 0;
  const missCount =
    result?.expectedTokens.filter((tk) => tk.status === "miss").length ?? 0;
  const convTitle = current
    ? (conversations.find((c) => c.id === current.conversationId)?.title ?? "")
    : "";
  const targetWordCount = current
    ? current.text.trim().split(/\s+/).filter(Boolean).length
    : 0;

  const sourceChip = current && (
    <span className="flex min-w-0 items-center gap-1.5">
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
      <span className="max-w-40 truncate">{convTitle}</span>
    </span>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden px-6 pt-4 pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
        {/* Header: title + source picker + settings, then the prompt-mode switch */}
        <div className="flex shrink-0 flex-col gap-4">
          <ProviderStatus onOpen={onOpenProviderSettings} kinds={["tts"]} />
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 flex items-center gap-2.5 text-ui-title font-semibold">
              <PencilLineIcon className="size-6 shrink-0 text-primary" />
              {t("dictationReview.title")}
            </h2>
            <div className="flex items-center gap-2">
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
          <div className="flex justify-center">
            <div className="inline-flex rounded-lg border bg-card p-0.5 text-ui-caption">
              {(["audio", "meaning"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  data-active={mode === m}
                  className="rounded-md px-3.5 py-1.5 font-medium text-ui-muted transition-colors data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                >
                  {m === "audio"
                    ? t("dictationReview.modeAudio")
                    : t("dictationReview.modeMeaning")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!hasItems ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <PencilLineIcon className="mb-3 size-9 text-ui-muted" />
            <p className="m-0 text-ui-body text-foreground">
              {selectedIds.length === 0
                ? t("dictationReview.noSelection")
                : t("dictationReview.noItems")}
            </p>
            <p className="m-0 mt-1 max-w-sm text-ui-caption text-ui-muted">
              {t("dictationReview.noSelectionHint")}
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Progress */}
            <div className="mt-5 shrink-0">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${((index + 1) / items.length) * 100}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-center text-ui-caption tabular-nums text-ui-muted">
                {index + 1} / {items.length}
              </div>
            </div>

            {/* Stage — the active question. Top-anchored (not centred) so the prompt stays put as the
                answer grows across lines; the area scrolls if a long prompt + answer overflow. */}
            <div className="flex min-h-0 flex-1 flex-col items-center gap-8 overflow-y-auto px-2 pt-10 pb-6">
              {!answered ? (
                <>
                  {mode === "audio" ? (
                    /* By ear — the play button is the hero */
                    <div className="flex flex-col items-center gap-4">
                      <button
                        type="button"
                        onClick={() =>
                          current && void play(current.text, "normal")
                        }
                        aria-label={t("dictationReview.playPronunciation")}
                        title={t("dictationReview.playPronunciation")}
                        className="relative inline-flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-minimal transition-transform hover:scale-105 active:scale-95"
                      >
                        {loading === "normal" ? (
                          <Spinner className="size-7" />
                        ) : (
                          <Volume2Icon className="size-8" />
                        )}
                        {playing && (
                          <span className="pointer-events-none absolute inset-0 animate-ping rounded-full ring-2 ring-primary/50" />
                        )}
                      </button>
                      <div className="flex items-center gap-3 text-ui-caption text-ui-muted">
                        <ReplayPill
                          loading={loading === "slow"}
                          onClick={() =>
                            current && void play(current.text, "slow")
                          }
                          label={t("dictationReview.slow")}
                          icon={<SnailIcon className="size-3.5" />}
                        />
                        {sourceChip}
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
                        <ReplayPill
                          loading={loading === "normal"}
                          onClick={() =>
                            current && void play(current.text, "normal")
                          }
                          label={t("dictationReview.playPronunciation")}
                          icon={<Volume2Icon className="size-3.5" />}
                        />
                        <ReplayPill
                          loading={loading === "slow"}
                          onClick={() =>
                            current && void play(current.text, "slow")
                          }
                          label={t("dictationReview.slow")}
                          icon={<SnailIcon className="size-3.5" />}
                        />
                        {sourceChip}
                      </div>
                    </div>
                  )}

                  {/* Transcribe — one underline per target word (a word-count hint); typed words fill them */}
                  <WordSlotsInput
                    ref={inputRef}
                    value={input}
                    onChange={setInput}
                    onKeyDown={onInputKeyDown}
                    targetWordCount={targetWordCount}
                    ariaLabel={
                      mode === "meaning"
                        ? t("dictationReview.inputPlaceholderMeaning")
                        : t("dictationReview.inputPlaceholder")
                    }
                  />
                </>
              ) : (
                /* Reveal — feedback is now the focus */
                <div className="flex w-full flex-col items-center gap-5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-ui-caption font-medium",
                      result?.correct
                        ? "bg-success/10 text-success"
                        : "bg-accent text-foreground",
                    )}
                  >
                    {result?.correct && <CheckIcon className="size-3.5" />}
                    {result?.correct
                      ? t("dictationReview.correct")
                      : t("dictationReview.missedWords", { n: missCount })}
                  </span>

                  <p className="m-0 text-pretty text-center text-xl leading-relaxed text-foreground">
                    {result?.expectedTokens.map((tk, i) => (
                      <span
                        key={`${i}-${tk.text}`}
                        className={cn(
                          tk.status === "miss" &&
                            "rounded bg-destructive/15 px-0.5 text-destructive",
                        )}
                      >
                        {tk.text}
                        {i < (result?.expectedTokens.length ?? 0) - 1
                          ? " "
                          : ""}
                      </span>
                    ))}
                  </p>

                  {current && (
                    <SpeakButton text={current.text} variant="round" />
                  )}

                  {input.trim() && (
                    <p className="m-0 max-w-full text-center text-ui-caption text-ui-muted">
                      {t("dictationReview.yourAnswer")}:{" "}
                      <span className="text-foreground">{input}</span>
                    </p>
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
                <button
                  type="button"
                  onClick={check}
                  className="inline-flex h-9 items-center gap-1.5 justify-self-center rounded-md bg-primary px-5 text-ui-body font-medium text-primary-foreground shadow-minimal transition-colors hover:bg-primary/90"
                >
                  <CheckIcon className="size-4" />
                  {t("dictationReview.check")}
                </button>
              ) : (
                <button
                  ref={nextRef}
                  type="button"
                  onClick={() => go(1)}
                  className="inline-flex h-9 items-center gap-1.5 justify-self-center rounded-md bg-primary px-5 text-ui-body font-medium text-primary-foreground shadow-minimal transition-colors hover:bg-primary/90"
                >
                  {t("dictationReview.next")}
                  <SkipForwardIcon className="size-4" />
                </button>
              )}
              {!answered ? (
                <button
                  type="button"
                  onClick={() => go(1)}
                  className="inline-flex h-9 items-center gap-1.5 justify-self-end rounded-md px-3 text-ui-body text-ui-muted transition-colors hover:bg-accent hover:text-foreground"
                >
                  {t("dictationReview.skip")}
                  <SkipForwardIcon className="size-4" />
                </button>
              ) : (
                <span />
              )}
            </div>
            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-ui-caption text-ui-muted">
              <ShortcutHint
                caps={actionKeyCaps("dictation-play")}
                label={t("dictationReview.playPronunciation")}
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
