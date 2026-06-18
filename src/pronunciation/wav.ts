// Recorded audio comes out of MediaRecorder as webm/opus (Chromium) or mp4/aac (WebKit). Gemini's
// inline audio accepts wav/mp3/aiff/aac/ogg/flac but not reliably webm/mp4, so we decode the recording
// with Web Audio (both WKWebView and WebView2 can decode their own MediaRecorder output) and re-emit a
// mono 16-bit PCM WAV — a format every audio backend accepts. No resampling: keeping the decoded sample
// rate sidesteps the historical WebKit OfflineAudioContext low-sample-rate quirk, and a short utterance
// is small enough that the extra bytes don't matter.

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const frames = samples.length;
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono · 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, frames * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // btoa over chunks: spreading the whole buffer into one call overflows the arg limit (same as stt/transcribe.ts).
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Decode a recorded blob and return base64-encoded mono 16-bit PCM WAV (mimeType: "audio/wav"). */
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }
  return base64(encodeWav(decoded.getChannelData(0), decoded.sampleRate));
}
