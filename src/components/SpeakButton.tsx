import { Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getPlaybackSnapshot,
  playSpeech,
  stopSpeech,
  subscribePlayback,
} from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";
import { AnchoredErrorPopover } from "./ui/anchored-popover";
import { Spinner } from "./ui/spinner";

// Animated bars while playing (like a sound wave) — a clear "it's playing" cue.
function PlayingBars() {
  return (
    <span className="speak-bars" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

// bar: flat, blends into the action row; round: a standalone circular button
// (used in the natural-expression panel).
const SPEAK_BASE: Record<"bar" | "round", string> = {
  bar: "size-[1.85rem] rounded-md text-foreground hover:bg-accent hover:text-foreground",
  round:
    "size-[1.65rem] rounded-full bg-accent text-primary hover:bg-accent/70",
};
const SPEAK_PLAYING: Record<"bar" | "round", string> = {
  bar: "text-success hover:text-success",
  round: "bg-success/15 text-success hover:bg-success/15",
};

export function SpeakButton({
  text,
  variant = "bar",
  registerTrigger,
  shortcutLabel,
  ariaKeyShortcuts,
}: {
  text: string;
  variant?: "bar" | "round";
  registerTrigger?: (trigger: (() => void) | null) => void;
  shortcutLabel?: string;
  ariaKeyShortcuts?: string;
}) {
  const { t } = useTranslation();
  // Playback state comes from the global player, so this button also lights up
  // during auto-read.
  const playback = useSyncExternalStore(subscribePlayback, getPlaybackSnapshot);
  const active = playback.key === text;
  const playing = active && playback.phase === "playing";
  const playbackLoading = active && playback.phase === "loading";
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function handleClick() {
    if (active) {
      stopSpeech();
      return;
    }
    if (!text.trim() || localLoading) return;

    setError(null);
    setLocalLoading(true);
    try {
      const audio = await speakText(text);
      setLocalLoading(false);
      await playSpeech(audio, text);
    } catch (e) {
      setLocalLoading(false);
      if (e instanceof MissingTtsApiKeyError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }
  actionRef.current = () => void handleClick();

  useEffect(() => {
    if (!registerTrigger) return;
    const run = () => actionRef.current();
    registerTrigger(run);
    return () => registerTrigger(null);
  }, [registerTrigger]);

  const label = active ? t("speak.stop") : t("speak.play");
  const title = shortcutLabel ? `${label} · ${shortcutLabel}` : label;

  return (
    <span className="inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex items-center justify-center transition-colors disabled:cursor-default disabled:opacity-45",
          SPEAK_BASE[variant],
          playing && SPEAK_PLAYING[variant],
        )}
        onClick={() => void handleClick()}
        disabled={localLoading || !text.trim()}
        aria-label={label}
        aria-keyshortcuts={ariaKeyShortcuts}
        title={title}
      >
        {localLoading || playbackLoading ? (
          <Spinner className="size-3" />
        ) : playing ? (
          <PlayingBars />
        ) : (
          <Volume2Icon size={variant === "round" ? 15 : 18} />
        )}
      </button>
      <AnchoredErrorPopover
        anchorRef={triggerRef}
        message={error}
        onClose={() => setError(null)}
        closeLabel={t("common.close")}
      />
    </span>
  );
}

export function SpeakableText({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="min-w-0 flex-1 whitespace-pre-wrap leading-snug">
        {text}
      </span>
      <SpeakButton text={text} variant="round" />
    </div>
  );
}
