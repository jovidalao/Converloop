import {
  beginSpeechStream,
  endSpeechStream,
  enqueueSpeech,
  setSpeechStreamKey,
} from "./playback";
import { SentenceSegmenter, splitFirstSentence } from "./segment";
import { MissingTtsApiKeyError, speakText } from "./speak";

const MIN_FIRST_CHUNK_WORDS = 10;

export interface ReplySpeaker {
  /** 每次回复增量更新时喂入到目前为止的完整文本。 */
  push(fullText: string): void;
  /** 回复结束时调用,fullText 为最终回复;收尾并让朗读按钮亮起。 */
  finish(fullText: string): void;
  /** 中止(出错或换了轮次);停止合成,播放交由 stopSpeech 处理。 */
  abort(): void;
}

function restAfterFirst(fullText: string, firstText: string): string {
  const full = fullText.trim();
  const first = firstText.trim();
  if (!full || !first) return "";
  const i = full.indexOf(first);
  if (i >= 0) return full.slice(i + first.length).trim();

  const compactFull = full.replace(/\s+/g, " ");
  const compactFirst = first.replace(/\s+/g, " ");
  if (compactFull.startsWith(compactFirst)) {
    return compactFull.slice(compactFirst.length).trim();
  }
  return "";
}

function wordCount(text: string): number {
  const spacedCjk = text.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu,
    " $& ",
  );
  return spacedCjk.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function joinSentences(sentences: string[]): string {
  return sentences.join(" ").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest) {
    const split = splitFirstSentence(rest);
    if (!split) {
      out.push(rest);
      break;
    }
    out.push(split.first);
    rest = split.rest;
  }
  return out;
}

function firstChunkForText(text: string): string {
  const firstParts: string[] = [];
  for (const sentence of splitSentences(text)) {
    firstParts.push(sentence);
    const candidate = joinSentences(firstParts);
    if (wordCount(candidate) >= MIN_FIRST_CHUNK_WORDS) return candidate;
  }
  return joinSentences(firstParts);
}

// 边收流边抢第一段合成,第一段由完整句子组成且尽量不少于 10 个词。
// 回复完成后,剩余文本合并为一次 TTS 请求,避免逐句请求过多。无 TTS key 时静默跳过。
export function createReplySpeaker(): ReplySpeaker {
  const seg = new SentenceSegmenter();
  const pending: string[] = []; // 待合成的文本块:第一段 + 剩余全文。
  let token: number | null = null;
  let started = false;
  let finished = false;
  let aborted = false;
  let firstText: string | null = null;
  const firstParts: string[] = [];
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
          console.warn("朗读合成失败:", e);
          continue; // 跳过这句,继续后面的。
        }
        if (aborted) return;
        enqueueSpeech(tok, audio);
      }
    } finally {
      endSpeechStream(tok);
    }
  }

  function enqueueText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    ensureStarted();
    pending.push(trimmed);
    notify();
  }

  return {
    push(fullText: string) {
      if (aborted || firstText) return;
      const sentences = seg.push(fullText);
      for (const sentence of sentences) {
        firstParts.push(sentence);
        const candidate = joinSentences(firstParts);
        if (wordCount(candidate) >= MIN_FIRST_CHUNK_WORDS) {
          firstText = candidate;
          enqueueText(candidate);
          break;
        }
      }
    },
    finish(fullText: string) {
      if (aborted || finished) return;

      const finalText = fullText.trim();
      if (finalText) {
        if (firstText) {
          enqueueText(restAfterFirst(finalText, firstText));
        } else {
          firstText = firstChunkForText(finalText);
          enqueueText(firstText);
          enqueueText(restAfterFirst(finalText, firstText));
        }
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
