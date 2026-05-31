let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// 当前正在播放的文本(用作每个朗读按钮的"是不是我在响"判定);空闲为 null。
let currentKey: string | null = null;
let currentPhase: "loading" | "playing" | null = null;
let currentSnapshot: PlaybackSnapshot = { key: null, phase: null };
// 当前段播放完毕的回调,用于在 stopSpeech 时让等待中的播放 promise 立即落定。
let currentSettle: (() => void) | null = null;

// 流式分句播放:把陆续合成出来的音频段按序无缝连播。
const segmentQueue: ArrayBuffer[] = [];
let streamToken = 0; // 每次 stop / 新会话自增,使过期的段与合成结果失效。
let streamActive = false; // 会话仍开放:后续可能还有段进来。
let draining = false; // 队列消费循环是否在跑。

const listeners = new Set<() => void>();

export interface PlaybackSnapshot {
  key: string | null;
  phase: "loading" | "playing" | null;
}

/** 订阅播放状态变化(含自动朗读)。返回取消订阅函数。 */
export function subscribePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 正在播放的文本,没有则 null。给 useSyncExternalStore 当快照。 */
export function getPlayingKey(): string | null {
  return currentKey;
}

/** 当前朗读状态。loading 表示音频仍在合成/等待首段,playing 表示已开始播放。 */
export function getPlaybackSnapshot(): PlaybackSnapshot {
  return currentSnapshot;
}

function emit() {
  currentSnapshot = { key: currentKey, phase: currentPhase };
  for (const l of listeners) l();
}

function cleanup() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentAudio = null;
  currentKey = null;
  currentPhase = null;
  currentSettle = null;
}

function cleanupAudioOnly() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentAudio = null;
  currentSettle = null;
}

export function stopSpeech(): void {
  streamToken += 1; // 让进行中的会话与在途合成结果失效。
  streamActive = false;
  segmentQueue.length = 0;
  if (currentSettle) {
    const settle = currentSettle;
    currentSettle = null;
    settle(); // 解开等待中的播放 promise,避免悬挂。
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  cleanup();
  emit();
}

// 播放单个音频段,在播放结束(或被 stop 打断)时落定。currentKey 由调用方维护。
function playBuffer(audioBytes: ArrayBuffer, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== streamToken) {
      resolve();
      return;
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    const blob = new Blob([audioBytes], { type: "audio/wav" });
    currentObjectUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentObjectUrl);
    currentSettle = resolve;
    currentPhase = "playing";
    emit();

    const audio = currentAudio;
    audio.onended = () => {
      currentSettle = null;
      resolve();
    };
    audio.onerror = () => {
      currentSettle = null;
      reject(new Error("音频播放失败"));
    };
    void audio.play().catch((e) => {
      currentSettle = null;
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/** 一次性播放整段音频(朗读按钮手动播放用)。 */
export async function playSpeech(
  audioBytes: ArrayBuffer,
  key?: string,
): Promise<void> {
  stopSpeech();
  streamToken += 1;
  currentKey = key ?? null;
  currentPhase = currentKey ? "loading" : null;
  const token = streamToken;
  try {
    await playBuffer(audioBytes, token);
  } finally {
    if (token === streamToken) {
      cleanup();
      emit();
    }
  }
}

/** 开启一个流式朗读会话,取消当前播放。返回会话 token。 */
export function beginSpeechStream(displayKey: string | null): number {
  stopSpeech();
  streamToken += 1;
  streamActive = true;
  currentKey = displayKey;
  currentPhase = displayKey ? "loading" : null;
  emit();
  return streamToken;
}

/** 更新会话的显示 key(例如整段回复文本确定后,让对应朗读按钮亮起)。 */
export function setSpeechStreamKey(token: number, key: string): void {
  if (token !== streamToken) return;
  currentKey = key;
  currentPhase = currentAudio ? "playing" : "loading";
  emit();
}

/** 向会话追加一段已合成的音频;过期会话忽略。 */
export function enqueueSpeech(token: number, audioBytes: ArrayBuffer): void {
  if (token !== streamToken || !streamActive) return;
  segmentQueue.push(audioBytes);
  void drainQueue(token);
}

/** 标记会话不会再有新段进来;队列放完后自动收尾。 */
export function endSpeechStream(token: number): void {
  if (token !== streamToken) return;
  streamActive = false;
  if (!draining && segmentQueue.length === 0) {
    cleanup();
    emit();
  }
}

async function drainQueue(token: number): Promise<void> {
  if (draining) return;
  draining = true;
  while (token === streamToken && segmentQueue.length > 0) {
    const buf = segmentQueue.shift()!;
    try {
      await playBuffer(buf, token);
      if (token === streamToken && streamActive && segmentQueue.length === 0) {
        cleanupAudioOnly();
        currentPhase = currentKey ? "loading" : null;
        emit();
      }
    } catch (e) {
      console.warn("分段播放失败:", e);
      break;
    }
  }
  draining = false;
  if (token === streamToken && !streamActive && segmentQueue.length === 0) {
    cleanup();
    emit();
  }
}
