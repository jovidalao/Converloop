import {
  EyeIcon,
  EyeOffIcon,
  HeadphonesIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  Settings2Icon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ConversationMeta } from "../db/conversations";
import { loadChatHistory } from "../db/turns";
import {
  EDGE_VOICES,
  loadTtsConfig,
  MIMO_VOICES,
  TTS_CONFIG_CHANGED_EVENT,
} from "../tts/config";
import { buildConversationItems, type ListeningItem } from "../tts/listening";
import {
  pauseSpeech,
  playSpeech,
  resumeSpeech,
  seekSpeech,
  stopSpeech,
} from "../tts/playback";
import { speakText } from "../tts/speak";
import { ConversationPickerPopover } from "./ConversationPicker";
import { type ProviderKind, ProviderStatus } from "./ProviderStatus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Spinner } from "./ui/spinner";

const STORAGE_KEY = "lang-agent.listening";
// Sentinel for the "follow global TTS voice" option — Radix Select forbids an empty-string value,
// so the empty override ("") is shown/selected via this id and mapped back to "" on change.
const FOLLOW_GLOBAL = "__global__";
const REPEAT_OPTIONS = [1, 2, 3, 5];
const SPEED_OPTIONS = [0.75, 1, 1.25];
const GAP_OPTIONS_MS = [0, 500, 1000, 2000];

interface PersistedState {
  selectedIds: string[];
  repeat: number;
  rate: number;
  gapMs: number;
  loop: boolean;
  hideText: boolean;
  /** Voice override for learner lines / AI lines ("" = follow the global TTS voice). */
  userVoice: string;
  aiVoice: string;
}

const DEFAULTS: PersistedState = {
  selectedIds: [],
  repeat: 2,
  rate: 1,
  gapMs: 800,
  loop: true,
  hideText: false,
  userVoice: "",
  aiVoice: "",
};

// Voices for the active TTS provider (the listening page picks among these for each side).
function currentVoiceOptions(): { id: string; label: string }[] {
  return loadTtsConfig().ttsProvider === "edge" ? EDGE_VOICES : MIMO_VOICES;
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedState>) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Shared dismiss behaviour for the manual popovers (outside click + Escape). Both popovers
// anchor to their own trigger and float over the player; this keeps that logic in one place.
function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  ref: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const node = e.target as HTMLElement;
      // A Select inside the popover renders its options in a separate Radix portal — clicking
      // one is "outside" the panel but must not dismiss it.
      if (node.closest?.("[data-radix-popper-content-wrapper]")) return;
      if (ref.current && !ref.current.contains(node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, ref]);
}

// One side's voice picker. Empty value ("") = follow the global TTS voice, shown via the
// FOLLOW_GLOBAL sentinel; choosing a specific voice re-synthesizes that side's lines in it.
function VoiceSelect({
  defaultLabel,
  value,
  onChange,
  options,
}: {
  defaultLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <Select
      value={value || FOLLOW_GLOBAL}
      onValueChange={(v) => onChange(v === FOLLOW_GLOBAL ? "" : v)}
    >
      <SelectTrigger className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={FOLLOW_GLOBAL}>{defaultLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Which side's voice override applies to a line ("" = follow the global TTS voice).
function voiceForSide(
  side: ListeningItem["side"],
  s: { userVoice: string; aiVoice: string },
): string {
  return side === "user" ? s.userVoice : s.aiVoice;
}

type Phase = "idle" | "loading" | "playing" | "gap";

// Sequential listening player over an ordered list of lines. Plays each line `repeat` times
// (with a gap between repeats and between lines) at `rate`, then advances; loops the whole list
// when enabled. Cancellation uses a run-id generation guard; pausing settles any in-flight
// playSpeech/wait so the loop unwinds. The next line's audio is prefetched while the current one
// plays — speakText caches in IndexedDB, so repeats and replays are served without re-synthesis.
function useListeningPlayer(
  items: ListeningItem[],
  settingsRef: React.RefObject<{
    repeat: number;
    rate: number;
    gapMs: number;
    loop: boolean;
    userVoice: string;
    aiVoice: string;
  }>,
) {
  // `playing` = audio is actively progressing; `paused` = a run is still in progress but halted
  // mid-line (resume continues from the same spot). Both false = idle.
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const [rep, setRep] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  // Playback progress of the current line's audio (0–1), used to drive the fill bar.
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const indexRef = useRef(0);
  const playingRef = useRef(false);
  const pausedRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const waitCancelRef = useRef<(() => void) | null>(null);
  // Resolver that unblocks the run loop's pause gate; set while paused at a non-audio checkpoint.
  const pauseGateRef = useRef<(() => void) | null>(null);

  const setPlayingBoth = useCallback((v: boolean) => {
    playingRef.current = v;
    setPlaying(v);
  }, []);

  const setPausedBoth = useCallback((v: boolean) => {
    pausedRef.current = v;
    setPaused(v);
  }, []);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    stopSpeech();
    waitCancelRef.current?.();
    waitCancelRef.current = null;
    pauseGateRef.current?.(); // release a paused loop so it can observe the new runId and exit
    pauseGateRef.current = null;
    setPlayingBoth(false);
    setPausedBoth(false);
    setPhase("idle");
    setRep(0);
    setProgress(0);
  }, [setPlayingBoth, setPausedBoth]);

  // Block the run loop while paused at a non-audio checkpoint (mid-line pauses are handled by
  // pausing the audio element itself, which keeps the awaited playSpeech promise pending).
  const waitWhilePaused = useCallback((runId: number) => {
    if (!pausedRef.current || runId !== runIdRef.current)
      return Promise.resolve();
    return new Promise<void>((resolve) => {
      pauseGateRef.current = () => {
        pauseGateRef.current = null;
        resolve();
      };
    });
  }, []);

  const wait = useCallback(
    (ms: number, runId: number) =>
      new Promise<void>((resolve) => {
        if (ms <= 0 || runId !== runIdRef.current) {
          resolve();
          return;
        }
        const timer = window.setTimeout(() => {
          waitCancelRef.current = null;
          resolve();
        }, ms);
        waitCancelRef.current = () => {
          window.clearTimeout(timer);
          resolve();
        };
      }),
    [],
  );

  const run = useCallback(
    async (fromIndex: number) => {
      if (itemsRef.current.length === 0) return;
      runIdRef.current += 1;
      const runId = runIdRef.current;
      setError(null);
      setPlayingBoth(true);
      let i = Math.max(0, Math.min(fromIndex, itemsRef.current.length - 1));
      while (runId === runIdRef.current) {
        const list = itemsRef.current;
        if (i >= list.length) {
          if (settingsRef.current.loop && list.length > 0) i = 0;
          else break;
        }
        const item = list[i];
        if (!item) break;
        indexRef.current = i;
        setIndex(i);
        const reps = Math.max(1, settingsRef.current.repeat);
        for (let r = 1; r <= reps; r++) {
          if (runId !== runIdRef.current) return;
          setRep(r);
          setPhase("loading");
          setProgress(0);
          let audio: ArrayBuffer;
          try {
            audio = await speakText(item.text, {
              voice: voiceForSide(item.side, settingsRef.current),
            });
          } catch (e) {
            if (runId !== runIdRef.current) return;
            setError(e instanceof Error ? e.message : String(e));
            stop();
            return;
          }
          if (runId !== runIdRef.current) return;
          // Warm the next line's cache (with its own side's voice) while this one plays.
          if (r === 1) {
            const next =
              list[i + 1] ?? (settingsRef.current.loop ? list[0] : undefined);
            if (next && next.id !== item.id)
              void speakText(next.text, {
                voice: voiceForSide(next.side, settingsRef.current),
              }).catch(() => {});
          }
          // If paused between lines/repeats, hold here until resumed (the audio for this line
          // hasn't started yet, so there's no element to pause — the gate stands in for it).
          await waitWhilePaused(runId);
          if (runId !== runIdRef.current) return;
          setPhase("playing");
          try {
            await playSpeech(audio, item.id, {
              rate: settingsRef.current.rate,
              onProgress: (f) => {
                if (runId === runIdRef.current) setProgress(f);
              },
            });
          } catch {
            // A playback error on one repeat shouldn't kill the session; move on.
          }
          if (runId !== runIdRef.current) return;
          if (r < reps) {
            setPhase("gap");
            await wait(settingsRef.current.gapMs, runId);
            if (runId !== runIdRef.current) return;
          }
        }
        setPhase("gap");
        await wait(settingsRef.current.gapMs, runId);
        if (runId !== runIdRef.current) return;
        i += 1;
      }
      if (runId === runIdRef.current) {
        setPlayingBoth(false);
        setPhase("idle");
        setRep(0);
        setProgress(0);
      }
    },
    [setPlayingBoth, settingsRef, stop, wait, waitWhilePaused],
  );

  const play = useCallback(() => void run(indexRef.current), [run]);

  // Freeze the current line in place (audio element pause + loop gate), keeping position so resume
  // continues from the same spot instead of restarting the line.
  const pause = useCallback(() => {
    if (!playingRef.current) return;
    setPlayingBoth(false);
    setPausedBoth(true);
    pauseSpeech();
  }, [setPlayingBoth, setPausedBoth]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    setPausedBoth(false);
    setPlayingBoth(true);
    resumeSpeech(); // continues a mid-line audio element...
    pauseGateRef.current?.(); // ...or releases the gate if paused between lines
  }, [setPlayingBoth, setPausedBoth]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else if (pausedRef.current) resume();
    else play();
  }, [pause, resume, play]);

  // Scrub within the current line's audio (and reflect it immediately on the bar).
  const seek = useCallback((fraction: number) => {
    seekSpeech(fraction);
    setProgress(Math.max(0, Math.min(1, fraction)));
  }, []);

  const jumpTo = useCallback(
    (target: number) => {
      const wasPlaying = playingRef.current;
      const len = itemsRef.current.length;
      if (len === 0) return;
      stop();
      const clamped = Math.max(0, Math.min(target, len - 1));
      indexRef.current = clamped;
      setIndex(clamped);
      setRep(0);
      setProgress(0);
      if (wasPlaying) void run(clamped);
    },
    [run, stop],
  );

  const next = useCallback(() => {
    const len = itemsRef.current.length;
    let i = indexRef.current + 1;
    if (i >= len) i = settingsRef.current.loop ? 0 : len - 1;
    jumpTo(i);
  }, [jumpTo, settingsRef]);

  const prev = useCallback(() => {
    let i = indexRef.current - 1;
    if (i < 0) i = settingsRef.current.loop ? itemsRef.current.length - 1 : 0;
    jumpTo(i);
  }, [jumpTo, settingsRef]);

  // Playlist shrank past the cursor (deselected a conversation): reset to the top.
  useEffect(() => {
    if (indexRef.current >= items.length) {
      stop();
      indexRef.current = 0;
      setIndex(0);
      setRep(0);
      setProgress(0);
    }
  }, [items, stop]);

  // Stop audio when leaving the view.
  useEffect(() => () => stop(), [stop]);

  return {
    playing,
    paused,
    index,
    rep,
    phase,
    progress,
    error,
    toggle,
    next,
    prev,
    jumpTo,
    seek,
  };
}

// One label/control row inside the settings popover — divider rows, the control is the only
// bordered element (matches the rest of the app's settings surfaces).
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

// Playback settings tucked into a gear popover: repeat / speed / gap / per-side voices. These are
// set-once knobs, so keeping them out of the main view leaves the player focused on listening.
function SettingsPopover({
  repeat,
  setRepeat,
  rate,
  setRate,
  gapMs,
  setGapMs,
  userVoice,
  setUserVoice,
  aiVoice,
  setAiVoice,
  voiceOptions,
}: {
  repeat: number;
  setRepeat: (n: number) => void;
  rate: number;
  setRate: (n: number) => void;
  gapMs: number;
  setGapMs: (n: number) => void;
  userVoice: string;
  setUserVoice: (v: string) => void;
  aiVoice: string;
  setAiVoice: (v: string) => void;
  voiceOptions: { id: string; label: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, () => setOpen(false), ref);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("listening.settingsLabel")}
        title={t("listening.settingsLabel")}
        className="inline-flex size-9 items-center justify-center rounded-md border text-ui-muted transition-colors hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
        data-active={open}
      >
        <Settings2Icon className="size-4" />
      </button>
      {open && (
        <div
          data-listening-overlay
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-72 rounded-lg border bg-popover px-3 text-popover-foreground shadow-minimal"
        >
          <SettingRow label={t("listening.repeatLabel")}>
            <Select
              value={String(repeat)}
              onValueChange={(v) => setRepeat(Number(v))}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPEAT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("listening.repeatTimes", { n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t("listening.speedLabel")}>
            <Select
              value={String(rate)}
              onValueChange={(v) => setRate(Number(v))}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEED_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t("listening.gapLabel")}>
            <Select
              value={String(gapMs)}
              onValueChange={(v) => setGapMs(Number(v))}
            >
              <SelectTrigger className="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAP_OPTIONS_MS.map((ms) => (
                  <SelectItem key={ms} value={String(ms)}>
                    {ms === 0
                      ? t("listening.gapOff")
                      : t("listening.gapSeconds", { n: ms / 1000 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label={t("listening.userVoice")}>
            <VoiceSelect
              defaultLabel={t("listening.voiceDefault")}
              value={userVoice}
              onChange={setUserVoice}
              options={voiceOptions}
            />
          </SettingRow>
          <SettingRow label={t("listening.aiVoice")}>
            <VoiceSelect
              defaultLabel={t("listening.voiceDefault")}
              value={aiVoice}
              onChange={setAiVoice}
              options={voiceOptions}
            />
          </SettingRow>
        </div>
      )}
    </div>
  );
}

export function ListeningView({
  conversations,
  onOpenProviderSettings,
}: {
  conversations: ConversationMeta[];
  /** Open the settings section for a provider summary item (here: TTS). */
  onOpenProviderSettings?: (kind: ProviderKind) => void;
}) {
  const { t } = useTranslation();
  const initial = useRef(loadPersisted()).current;
  const [selectedIds, setSelectedIds] = useState<string[]>(initial.selectedIds);
  const [repeat, setRepeat] = useState(initial.repeat);
  const [rate, setRate] = useState(initial.rate);
  const [gapMs, setGapMs] = useState(initial.gapMs);
  const [loop, setLoop] = useState(initial.loop);
  const [hideText, setHideText] = useState(initial.hideText);
  const [userVoice, setUserVoice] = useState(initial.userVoice);
  const [aiVoice, setAiVoice] = useState(initial.aiVoice);
  const [voiceOptions, setVoiceOptions] = useState(currentVoiceOptions);

  const [itemsByConv, setItemsByConv] = useState<
    Record<string, ListeningItem[]>
  >({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const loadingRef = useRef(new Set<string>());

  // Track the active provider's voice list (it changes if TTS settings are edited elsewhere).
  useEffect(() => {
    const refresh = () => setVoiceOptions(currentVoiceOptions());
    window.addEventListener(TTS_CONFIG_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(TTS_CONFIG_CHANGED_EVENT, refresh);
  }, []);

  // Persist player settings + the chosen playlist across navigation.
  useEffect(() => {
    const state: PersistedState = {
      selectedIds,
      repeat,
      rate,
      gapMs,
      loop,
      hideText,
      userVoice,
      aiVoice,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [selectedIds, repeat, rate, gapMs, loop, hideText, userVoice, aiVoice]);

  // Drop selections whose conversation has since been deleted.
  useEffect(() => {
    setSelectedIds((prev) => {
      const live = prev.filter((id) => conversations.some((c) => c.id === id));
      return live.length === prev.length ? prev : live;
    });
  }, [conversations]);

  // Lazily load + extract listening lines for each newly selected conversation.
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

  const items = useMemo(
    () => selectedIds.flatMap((id) => itemsByConv[id] ?? []),
    [selectedIds, itemsByConv],
  );

  const settingsRef = useRef({ repeat, rate, gapMs, loop, userVoice, aiVoice });
  settingsRef.current = { repeat, rate, gapMs, loop, userVoice, aiVoice };
  const player = useListeningPlayer(items, settingsRef);
  const { toggle, next, prev } = player;

  // Player keyboard shortcuts (Space play/pause · ←/→ prev/next). Skipped while typing or while a
  // popover/select holds focus, so source-picking and settings keep their own keys.
  useEffect(() => {
    if (items.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[data-listening-overlay]")) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable ||
        el?.closest("[role='listbox'],[role='dialog']")
      )
        return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, toggle, next, prev]);

  const convTitleById = useMemo(
    () => new Map(conversations.map((c) => [c.id, c.title])),
    [conversations],
  );

  function toggleConv(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAll() {
    setSelectedIds(conversations.map((c) => c.id));
  }

  const current = items[player.index];
  const sideLabel = (side: "user" | "ai") =>
    side === "user" ? t("listening.sideUser") : t("listening.sideAi");
  const hasItems = items.length > 0;

  // Seek bar. The current line's audio element exists only during the "playing" phase (it survives a
  // mid-line pause, which keeps phase === "playing"), so scrubbing is enabled exactly then. While
  // dragging, the local `scrub` fraction drives the bar for instant feedback; release commits the seek.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbingRef = useRef(false);
  const canSeek = player.phase === "playing";
  // Fill bar tracks how far through the *current line's* audio we are (not playlist position).
  const progressPct = (scrub ?? player.progress) * 100;

  const fractionAt = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbingRef.current = true;
    setScrub(fractionAt(e.currentTarget, e.clientX));
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    setScrub(fractionAt(e.currentTarget, e.clientX));
  };
  const onScrubUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    player.seek(fractionAt(e.currentTarget, e.clientX));
    setScrub(null);
  };
  const onScrubKey = (e: React.KeyboardEvent) => {
    if (!canSeek) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      player.seek(player.progress - 0.05);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      player.seek(player.progress + 0.05);
    }
  };

  // Progressive reveal while hiding text: a line is blurred only until it has been heard. Lines
  // before the cursor are already read (revealed), and the current line reveals on its final
  // repeat — so the learner gets the answer after listening, not before.
  const onLastRep = player.rep >= Math.max(1, repeat);
  const blurLine = (i: number) =>
    hideText && i >= player.index && !(i === player.index && onLastRep);

  return (
    <div className="flex h-full flex-col overflow-hidden px-6 pt-4 pb-6">
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        {/* Provider status (listening only synthesizes speech → TTS), then the title + source picker / settings row. */}
        <div className="mb-5 flex shrink-0 flex-col gap-4">
          <ProviderStatus onOpen={onOpenProviderSettings} kinds={["tts"]} />
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 flex items-center gap-2.5 text-ui-title font-semibold">
              <HeadphonesIcon className="size-6 shrink-0 text-primary" />
              {t("listening.title")}
            </h2>
            <div className="flex items-center gap-2">
              <ConversationPickerPopover
                conversations={conversations}
                selectedIds={selectedIds}
                itemsByConv={itemsByConv}
                loadingIds={loadingIds}
                onToggle={toggleConv}
                onSelectAll={selectAll}
                onClear={() => setSelectedIds([])}
              />
              {hasItems && (
                <SettingsPopover
                  repeat={repeat}
                  setRepeat={setRepeat}
                  rate={rate}
                  setRate={setRate}
                  gapMs={gapMs}
                  setGapMs={setGapMs}
                  userVoice={userVoice}
                  setUserVoice={setUserVoice}
                  aiVoice={aiVoice}
                  setAiVoice={setAiVoice}
                  voiceOptions={voiceOptions}
                />
              )}
            </div>
          </div>
        </div>

        {!hasItems ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <HeadphonesIcon className="mb-3 size-9 text-ui-muted" />
            <p className="m-0 text-ui-body text-foreground">
              {selectedIds.length === 0
                ? t("listening.noSelection")
                : t("listening.noItems")}
            </p>
            <p className="m-0 mt-1 max-w-sm text-ui-caption text-ui-muted">
              {t("listening.noSelectionHint")}
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Now playing — a focused, box-free stage. */}
            <div className="flex shrink-0 flex-col items-center px-2 pt-4 pb-5 text-center">
              <div className="mb-4 flex max-w-full items-center gap-2 text-ui-caption text-ui-muted">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 font-medium",
                    current?.side === "user"
                      ? "bg-primary/10 text-primary"
                      : "bg-accent text-foreground",
                  )}
                >
                  {current ? sideLabel(current.side) : ""}
                </span>
                <span className="truncate">
                  {current
                    ? (convTitleById.get(current.conversationId) ?? "")
                    : ""}
                </span>
              </div>
              <p
                className={cn(
                  // px-4 gives the blur room to fade past the text edges (otherwise the filter is
                  // clipped flush to the glyphs, leaving a hard cut at the first/last letter).
                  "m-0 min-h-[3.5rem] max-w-xl px-4 text-pretty text-[1.1875rem] leading-relaxed text-foreground transition",
                  blurLine(player.index) && "select-none blur-[6px]",
                )}
              >
                {current?.text}
              </p>
            </div>

            {/* Progress + position */}
            <div className="shrink-0 px-2">
              <div
                role="slider"
                aria-label={t("listening.seek")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressPct)}
                aria-disabled={!canSeek}
                tabIndex={canSeek ? 0 : -1}
                onPointerDown={onScrubDown}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubUp}
                onKeyDown={onScrubKey}
                className={cn(
                  "group relative -my-2 py-2 outline-none",
                  canSeek ? "cursor-pointer" : "cursor-default",
                )}
              >
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full bg-primary",
                      scrub === null &&
                        "transition-[width] duration-200 ease-linear",
                    )}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {canSeek && (
                  <div
                    className={cn(
                      "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-minimal",
                      // While dragging: no left transition, so the thumb stays glued to the pointer.
                      // Otherwise: ease `left` like the fill bar so it tracks the audio smoothly.
                      scrub !== null
                        ? "opacity-100"
                        : "opacity-0 transition-[left,opacity] duration-200 ease-linear group-hover:opacity-100 group-focus-visible:opacity-100",
                    )}
                    style={{ left: `${progressPct}%` }}
                  />
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-ui-caption tabular-nums text-ui-muted">
                <span>
                  {player.index + 1} / {items.length}
                </span>
                {player.playing && repeat > 1 && (
                  <span className="inline-flex items-center gap-1">
                    <RepeatIcon className="size-3" />
                    {player.rep}/{repeat}
                  </span>
                )}
              </div>
            </div>

            {/* Transport */}
            <div className="my-4 flex shrink-0 items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setLoop((v) => !v)}
                data-active={loop}
                className="inline-flex size-9 items-center justify-center rounded-full text-ui-muted transition-colors hover:bg-accent data-[active=true]:text-primary"
                aria-pressed={loop}
                aria-label={t("listening.loopLabel")}
                title={t("listening.loopLabel")}
              >
                <RepeatIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={prev}
                className="inline-flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
                aria-label={t("listening.prev")}
                title={t("listening.prev")}
              >
                <SkipBackIcon className="size-5" />
              </button>
              <button
                type="button"
                onClick={toggle}
                className="inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-minimal transition-transform hover:scale-105 active:scale-95"
                aria-label={
                  player.playing ? t("listening.pause") : t("listening.play")
                }
                title={
                  player.playing ? t("listening.pause") : t("listening.play")
                }
              >
                {player.playing && player.phase === "loading" ? (
                  <Spinner className="size-6" />
                ) : player.playing ? (
                  <PauseIcon className="size-6" />
                ) : (
                  <PlayIcon className="size-6 translate-x-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={next}
                className="inline-flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent"
                aria-label={t("listening.next")}
                title={t("listening.next")}
              >
                <SkipForwardIcon className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => setHideText((v) => !v)}
                data-active={hideText}
                className="inline-flex size-9 items-center justify-center rounded-full text-ui-muted transition-colors hover:bg-accent data-[active=true]:text-primary"
                aria-pressed={hideText}
                aria-label={
                  hideText ? t("listening.reveal") : t("listening.hide")
                }
                title={hideText ? t("listening.reveal") : t("listening.hide")}
              >
                {hideText ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>

            {player.error && (
              <div
                className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui-caption text-destructive"
                role="alert"
              >
                <span className="min-w-0 flex-1">{player.error}</span>
              </div>
            )}

            {/* Queue — fills the remaining height and scrolls on its own */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto border-t">
                {items.map((it, i) => {
                  const active = i === player.index;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => player.jumpTo(i)}
                      data-active={active}
                      className="flex w-full items-start gap-2.5 border-b px-3 py-2 text-left text-ui-body last:border-0 hover:bg-accent/60 data-[active=true]:bg-accent"
                    >
                      <span className="w-6 shrink-0 pt-0.5 text-right tabular-nums text-ui-caption text-ui-muted">
                        {i + 1}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-ui-caption font-medium",
                          it.side === "user"
                            ? "bg-primary/10 text-primary"
                            : "bg-accent text-ui-muted",
                        )}
                      >
                        {sideLabel(it.side)}
                      </span>
                      <span
                        className={cn(
                          // -mx-2 px-2: same blur-room trick as the main line; the negative margin
                          // keeps the row layout unchanged while padding pushes the truncate/clip
                          // box past the glyphs so the blur fades instead of cutting off.
                          "-mx-2 min-w-0 flex-1 truncate px-2 pt-0.5",
                          active ? "text-foreground" : "text-ui-muted",
                          blurLine(i) && "select-none blur-[5px]",
                        )}
                      >
                        {it.text}
                      </span>
                      {active && player.playing && (
                        <PlayIcon className="mt-1 size-3 shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="m-0 mt-2 shrink-0 text-center text-ui-caption text-ui-muted">
                {t("listening.shortcutHint")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
