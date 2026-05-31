import {
  beginSpeechStream,
  endSpeechStream,
  enqueueSpeech,
  setSpeechStreamKey,
} from "./playback";
import { SentenceSegmenter } from "./segment";
import { MissingTtsApiKeyError, speakText } from "./speak";

export interface ReplySpeaker {
  /** 每次回复增量更新时喂入到目前为止的完整文本。 */
  push(fullText: string): void;
  /** 回复结束时调用,fullText 为最终回复;收尾并让朗读按钮亮起。 */
  finish(fullText: string): void;
  /** 中止(出错或换了轮次);停止合成,播放交由 stopSpeech 处理。 */
  abort(): void;
}

// 边收流边分句、按序合成、入队无缝播放。合成在后台流水线跑,与播放重叠,
// 把首音延迟压到「LLM 第一句 + 合成第一句」。无 TTS key 时静默跳过。
export function createReplySpeaker(): ReplySpeaker {
  const seg = new SentenceSegmenter();
  const pending: string[] = []; // 待合成的句子文本,按序消费。
  let token: number | null = null;
  let started = false;
  let finished = false;
  let aborted = false;
  let wake: (() => void) | null = null;

  function ensureStarted() {
    if (started) return;
    started = true;
    token = beginSpeechStream(null);
    void worker(token);
  }

  function notify() {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  }

  async function worker(tok: number): Promise<void> {
    try {
      while (!aborted) {
        if (pending.length === 0) {
          if (finished) break;
          await new Promise<void>((r) => {
            wake = r;
          });
          continue;
        }
        const text = pending.shift()!;
        let audio: ArrayBuffer;
        try {
          audio = await speakText(text);
        } catch (e) {
          if (e instanceof MissingTtsApiKeyError) return; // 没配 key,静默退出。
          console.warn("分句朗读合成失败:", e);
          continue; // 跳过这句,继续后面的。
        }
        if (aborted) return;
        enqueueSpeech(tok, audio);
      }
    } finally {
      endSpeechStream(tok);
    }
  }

  return {
    push(fullText: string) {
      if (aborted) return;
      const sentences = seg.push(fullText);
      if (sentences.length > 0) {
        ensureStarted();
        pending.push(...sentences);
        notify();
      }
    },
    finish(fullText: string) {
      if (aborted) return;
      const tail = seg.flush(fullText);
      if (tail.length > 0) {
        ensureStarted();
        pending.push(...tail);
      }
      if (started && token !== null) setSpeechStreamKey(token, fullText);
      finished = true;
      notify();
    },
    abort() {
      aborted = true;
      finished = true;
      notify();
    },
  };
}
