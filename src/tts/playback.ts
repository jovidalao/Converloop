let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function cleanup() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  currentAudio = null;
}

export function stopSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  cleanup();
}

export function playSpeech(audioBytes: ArrayBuffer): Promise<void> {
  stopSpeech();
  const blob = new Blob([audioBytes], { type: "audio/wav" });
  currentObjectUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentObjectUrl);

  return new Promise((resolve, reject) => {
    const audio = currentAudio!;
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("音频播放失败"));
    };
    void audio.play().catch((e) => {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
