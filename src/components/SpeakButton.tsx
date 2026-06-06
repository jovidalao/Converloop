import { Volume2Icon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getPlaybackSnapshot,
  playSpeech,
  stopSpeech,
  subscribePlayback,
} from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";
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
}: {
  text: string;
  variant?: "bar" | "round";
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

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        className={cn(
          "inline-flex items-center justify-center transition-colors disabled:cursor-default disabled:opacity-45",
          SPEAK_BASE[variant],
          playing && SPEAK_PLAYING[variant],
        )}
        onClick={() => void handleClick()}
        disabled={localLoading || !text.trim()}
        aria-label={active ? t("speak.stop") : t("speak.play")}
        title={active ? t("speak.stop") : t("speak.play")}
      >
        {localLoading || playbackLoading ? (
          <Spinner className="size-3" />
        ) : playing ? (
          <PlayingBars />
        ) : (
          <Volume2Icon size={variant === "round" ? 15 : 18} />
        )}
      </button>
      {error && (
        <span
          className="pointer-events-none absolute right-0 top-[calc(100%+4px)] z-[2] w-max max-w-56 rounded bg-destructive/15 px-1.5 py-1 text-ui-caption leading-tight text-destructive"
          role="alert"
        >
          {error}
        </span>
      )}
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
