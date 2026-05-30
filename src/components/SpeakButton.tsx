import { useState, useSyncExternalStore } from "react";
import {
  getPlayingKey,
  playSpeech,
  stopSpeech,
  subscribePlayback,
} from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";

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

function SpeakerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

export function SpeakButton({ text }: { text: string }) {
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
    <span className="speak-btn-wrap">
      <button
        type="button"
        className={`speak-btn${playing ? " playing" : ""}`}
        onClick={() => void handleClick()}
        disabled={loading || !text.trim()}
        aria-label={playing ? "停止朗读" : "朗读"}
        title={playing ? "停止朗读" : "朗读"}
      >
        {loading ? (
          <span className="speak-btn-spinner" aria-hidden />
        ) : playing ? (
          <PlayingBars />
        ) : (
          <SpeakerIcon />
        )}
      </button>
      {error && (
        <span className="speak-btn-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export function SpeakableText({ text }: { text: string }) {
  return (
    <div className="speakable-row">
      <span className="speakable-text">{text}</span>
      <SpeakButton text={text} />
    </div>
  );
}
