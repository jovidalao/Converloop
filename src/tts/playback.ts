// Sniff audio MIME by content: MiMo returns WAV (RIFF header), Edge returns MP3. Giving the Blob the correct type is more reliable.
function sniffAudioMime(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes.slice(0, 4));
  // "RIFF" → WAV
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) {
    return "audio/wav";
  }
  return "audio/mpeg";
}

let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
// Text currently being played (used by each speak button to determine "am I the one currently playing"); null when idle.
let currentKey: string | null = null;
let currentPhase: "loading" | "playing" | null = null;
let currentSnapshot: PlaybackSnapshot = { key: null, phase: null };
// Callback invoked when the current playback finishes, used to immediately resolve the pending play promise when stopSpeech is called.
let currentSettle: (() => void) | null = null;
// Incremented on each stop / new playback to invalidate in-flight plays.
let playToken = 0;

const listeners = new Set<() => void>();

export interface PlaybackSnapshot {
  key: string | null;
  phase: "loading" | "playing" | null;
}

/** Subscribe to playback state changes (including auto-speak). Returns the unsubscribe function. */
export function subscribePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current playback state. "loading" means audio is still being synthesized/buffered; "playing" means playback has started. */
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
  playToken += 1; // Invalidate any in-flight plays.
  if (currentSettle) {
    const settle = currentSettle;
    currentSettle = null;
    settle(); // Resolve the pending play promise to avoid a hanging promise.
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  cleanup();
  emit();
}

// Play the full audio buffer, resolving when playback ends (or is interrupted by stop).
function playBuffer(
  audioBytes: ArrayBuffer,
  token: number,
  rate = 1,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token !== playToken) {
      resolve();
      return;
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    const blob = new Blob([audioBytes], { type: sniffAudioMime(audioBytes) });
    currentObjectUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentObjectUrl);
    // Slow replay (dictation): browsers pitch-correct by default (preservesPitch), so a reduced rate
    // sounds like slower speech, not a deeper voice.
    currentAudio.playbackRate = rate;
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
      reject(new Error("Audio playback failed"));
    };
    void audio.play().catch((e) => {
      currentSettle = null;
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/** Play the full audio at once (shared by the speak button manual playback and auto-speak).
 *  opts.rate < 1 plays slowed down with pitch preserved (dictation slow replay). */
export async function playSpeech(
  audioBytes: ArrayBuffer,
  key?: string,
  opts: { rate?: number } = {},
): Promise<void> {
  stopSpeech();
  playToken += 1;
  currentKey = key ?? null;
  currentPhase = currentKey ? "loading" : null;
  const token = playToken;
  try {
    await playBuffer(audioBytes, token, opts.rate ?? 1);
  } finally {
    if (token === playToken) {
      cleanup();
      emit();
    }
  }
}
