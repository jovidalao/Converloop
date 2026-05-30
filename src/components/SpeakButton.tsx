import { useState } from "react";
import { playSpeech, stopSpeech } from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";

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
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (state === "playing") {
      stopSpeech();
      setState("idle");
      return;
    }
    if (!text.trim() || state === "loading") return;

    setError(null);
    setState("loading");
    try {
      const audio = await speakText(text);
      setState("playing");
      await playSpeech(audio);
      setState("idle");
    } catch (e) {
      setState("idle");
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
        className={`speak-btn${state === "playing" ? " playing" : ""}`}
        onClick={() => void handleClick()}
        disabled={state === "loading" || !text.trim()}
        aria-label={state === "playing" ? "停止朗读" : "朗读"}
        title={state === "playing" ? "停止朗读" : "朗读"}
      >
        {state === "loading" ? (
          <span className="speak-btn-spinner" aria-hidden />
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
