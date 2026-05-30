let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// 当前正在播放的文本(用作每个朗读按钮的"是不是我在响"判定);空闲为 null。
let currentKey: string | null = null;

const listeners = new Set<() => void>();

/** 订阅播放状态变化(含自动朗读)。返回取消订阅函数。 */
export function subscribePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 正在播放的文本,没有则 null。给 useSyncExternalStore 当快照。 */
export function getPlayingKey(): string | null {
  return currentKey;
}

function emit() {
  for (const l of listeners) l();
}

function cleanup() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentAudio = null;
  currentKey = null;
}

export function stopSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  cleanup();
  emit();
}

export function playSpeech(audioBytes: ArrayBuffer, key?: string): Promise<void> {
  stopSpeech();
  const blob = new Blob([audioBytes], { type: "audio/wav" });
  currentObjectUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentObjectUrl);
  currentKey = key ?? null;
  emit();

  return new Promise((resolve, reject) => {
    const audio = currentAudio!;
    audio.onended = () => {
      cleanup();
      emit();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      emit();
      reject(new Error("音频播放失败"));
    };
    void audio.play().catch((e) => {
      cleanup();
      emit();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
