import { playSpeech } from "./playback";
import { MissingTtsApiKeyError, speakText } from "./speak";

export interface ReplySpeaker {
  /** Called when the reply is complete; fullText is the final reply. The full text is synthesized and played at once. */
  finish(fullText: string): Promise<void>;
  /** Abort (error or new turn started); discard this turn's synthesis result and do not play it. */
  abort(): void;
}

export async function speakAndPlayText(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const audio = await speakText(trimmed);
    await playSpeech(audio, trimmed);
  } catch (e) {
    if (e instanceof MissingTtsApiKeyError) return; // No key configured; silently skip.
    console.warn("TTS synthesis failed:", e);
  }
}

// Auto-speak: after the reply is complete, synthesize the full reply as a single TTS request and play it.
// Shares the same cache key (full text) with the speak button, so manual replay can hit the cache directly. Silently skips if no TTS key is configured.
export function createReplySpeaker(): ReplySpeaker {
  let aborted = false;
  return {
    async finish(fullText: string) {
      if (aborted) return;
      const text = fullText.trim();
      if (!text) return;
      try {
        const audio = await speakText(text);
        if (!aborted) await playSpeech(audio, text);
      } catch (e) {
        if (e instanceof MissingTtsApiKeyError) return; // No key configured; silently skip.
        console.warn("TTS synthesis failed:", e);
      }
    },
    abort() {
      aborted = true;
    },
  };
}
