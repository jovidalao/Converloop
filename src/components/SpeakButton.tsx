import { useState, useSyncExternalStore } from "react";
import {
  getPlayingKey,
  playSpeech,
  stopSpeech,
  subscribePlayback,
} from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";
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
          <IconVolume size={18} />
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
