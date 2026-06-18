import { Channel, invoke } from "@tauri-apps/api/core";

// Local STT (parakeet = NVIDIA Parakeet TDT 0.6B V3, qwen3 = Qwen3-ASR 0.6B int8).
// The model runs in Rust via sherpa-onnx; the frontend only:
//  1. Captures the whole utterance as s16le PCM (same public/pcm-worklet.js as Soniox streaming).
//  2. Sends the PCM to Rust once recording stops (no streaming).
// The recording-session shape intentionally stays close to stt/record.ts batch
// semantics, but stop() returns text directly because local inference happens there.

export type LocalSttEngine = "parakeet" | "qwen3";

export interface LocalCapture {
  /** Stop capture, send the full audio to the local model, and return the final transcript. */
  stop(): Promise<string>;
  /** Stop and discard (Esc / unmount). */
  cancel(): void;
}

export interface LocalDownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  received: number;
  total: number;
}

/** Whether this engine's model files are complete. */
export function localAsrModelStatus(engine: LocalSttEngine): Promise<boolean> {
  return invoke<boolean>("local_asr_model_status", { engine });
}

/** Download a model (parakeet ~640MB / qwen3 ~1GB), with progress over a Channel. */
export function downloadLocalAsrModel(
  engine: LocalSttEngine,
  onProgress: (p: LocalDownloadProgress) => void,
): Promise<void> {
  const channel = new Channel<LocalDownloadProgress>();
  channel.onmessage = onProgress;
  return invoke<void>("local_asr_download_model", {
    engine,
    onProgress: channel,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked btoa: spreading the whole buffer into one call overflows the arg limit.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function startLocalCapture(
  engine: LocalSttEngine,
): Promise<LocalCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const releaseMic = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  // Prefer direct 16k capture (the model sample rate). WebKit may ignore this, so
  // pass the actual sampleRate to Rust as a resampling fallback.
  const ctx = new AudioContext({ sampleRate: 16_000 });
  const closeCtx = () => {
    ctx.close().catch(() => {});
  };
  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
  } catch (e) {
    releaseMic();
    closeCtx();
    throw e instanceof Error ? e : new Error(String(e));
  }
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, "pcm-capture");
  // Older WebKit may not run detached nodes. Route through a zero-gain output as
  // a fallback without playing audio.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(capture);
  capture.connect(mute);
  mute.connect(ctx.destination);
  void ctx.resume();

  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  let stopped = false;
  capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (stopped) return;
    chunks.push(e.data);
    totalBytes += e.data.byteLength;
  };

  const teardown = () => {
    stopped = true;
    capture.port.onmessage = null;
    releaseMic();
    closeCtx();
  };

  return {
    async stop() {
      const sampleRate = ctx.sampleRate;
      teardown();
      const pcm = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }
      return invoke<string>("stt_transcribe_local", {
        engine,
        pcmS16leB64: bytesToBase64(pcm),
        sampleRate,
      });
    },
    cancel() {
      teardown();
    },
  };
}
