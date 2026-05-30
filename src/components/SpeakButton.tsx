import { useState, useSyncExternalStore } from "react";
import {
  getPlayingKey,
  playSpeech,
  stopSpeech,
  subscribePlayback,
} from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";
import { Spinner } from "./ui/spinner";
import { cn } from "@/lib/utils";
import { IconVolume } from "./icons";

// 正在播放时的动态条形(像声波),清晰地告诉用户"在响"。
function PlayingBars() {
  return (
    <span className="speak-bars" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

// bar: 扁平,融入操作行;round: 独立圆钮(地道表达面板里)。
const SPEAK_BASE: Record<"bar" | "round", string> = {
  bar: "size-[1.85rem] rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
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
  // 播放状态来自全局播放器,所以自动朗读时本按钮也会亮起。
  const playingKey = useSyncExternalStore(subscribePlayback, getPlayingKey);
  const playing = playingKey === text;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (playing) {
      stopSpeech();
      return;
    }
    if (!text.trim() || loading) return;

    setError(null);
    setLoading(true);
    try {
      const audio = await speakText(text);
      setLoading(false);
      await playSpeech(audio, text);
    } catch (e) {
      setLoading(false);
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
        disabled={loading || !text.trim()}
        aria-label={playing ? "停止朗读" : "朗读"}
        title={playing ? "停止朗读" : "朗读"}
      >
        {loading ? (
          <Spinner className="size-3" />
        ) : playing ? (
          <PlayingBars />
        ) : (
          <IconVolume size={variant === "round" ? 15 : 18} />
        )}
      </button>
      {error && (
        <span
          className="pointer-events-none absolute right-0 top-[calc(100%+4px)] z-[2] w-max max-w-[220px] rounded bg-destructive/15 px-1.5 py-1 text-[0.68rem] leading-tight text-destructive"
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
