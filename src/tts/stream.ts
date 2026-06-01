import { playSpeech } from "./playback";
import { MissingTtsApiKeyError, speakText } from "./speak";

export interface ReplySpeaker {
  /** 回复结束时调用,fullText 为最终回复;整条一次性合成并播放。 */
  finish(fullText: string): void;
  /** 中止(出错或换了轮次);放弃本轮合成结果,不再播放。 */
  abort(): void;
}

// 自动朗读:回复完成后,把整条回复作为一次 TTS 请求合成并播放。
// 与朗读按钮共用同一缓存键(整条文本),手动重播可直接命中缓存。无 TTS key 时静默跳过。
export function createReplySpeaker(): ReplySpeaker {
  let aborted = false;
  return {
    finish(fullText: string) {
      if (aborted) return;
      const text = fullText.trim();
      if (!text) return;
      void speakText(text)
        .then((audio) => {
          if (!aborted) void playSpeech(audio, text);
        })
        .catch((e) => {
          if (e instanceof MissingTtsApiKeyError) return; // 没配 key,静默跳过。
          console.warn("朗读合成失败:", e);
        });
    },
    abort() {
      aborted = true;
    },
  };
}
