let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// 当前正在播放的文本(用作每个朗读按钮的"是不是我在响"判定);空闲为 null。
let currentKey: string | null = null;
let currentPhase: "loading" | "playing" | null = null;
let currentSnapshot: PlaybackSnapshot = { key: null, phase: null };
// 当前播放完毕的回调,用于在 stopSpeech 时让等待中的播放 promise 立即落定。
let currentSettle: (() => void) | null = null;
// 每次 stop / 新播放自增,使在途的播放失效。
let playToken = 0;

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

/** 当前朗读状态。loading 表示音频仍在合成/等待,playing 表示已开始播放。 */
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

export function stopSpeech(): void {
  playToken += 1; // 让在途的播放失效。
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

// 播放整段音频,在播放结束(或被 stop 打断)时落定。
function playBuffer(audioBytes: ArrayBuffer, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== playToken) {
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

/** 一次性播放整段音频(朗读按钮手动播放、自动朗读共用)。 */
export async function playSpeech(
  audioBytes: ArrayBuffer,
  key?: string,
): Promise<void> {
  stopSpeech();
  playToken += 1;
  currentKey = key ?? null;
  currentPhase = currentKey ? "loading" : null;
  const token = playToken;
  try {
    await playBuffer(audioBytes, token);
  } finally {
    if (token === playToken) {
      cleanup();
      emit();
    }
  }
}
