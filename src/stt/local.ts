import { Channel, invoke } from "@tauri-apps/api/core";

// 本地 STT(Parakeet TDT 0.6B V3)。模型跑在 Rust 侧 sherpa-onnx,前端只负责:
//  1. 采集整段 s16le PCM(复用 public/pcm-worklet.js,与 Soniox 流式同一 worklet);
//  2. 录音结束后一次性把 PCM 交给 Rust 转写(无流式)。
// 录音会话接口刻意贴近 stt/record.ts 的批量语义,但 stop() 直接返回文本
// (本地推理就在 stop 时同步发生),省掉中间的 Blob。

export interface ParakeetCapture {
  /** 停止采集,把整段音频交给本地模型转写,返回最终文本。 */
  stop(): Promise<string>;
  /** 停止并丢弃(Esc / 卸载时)。 */
  cancel(): void;
}

export interface ParakeetDownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  received: number;
  total: number;
}

/** 四个模型文件是否齐全。 */
export function parakeetModelStatus(): Promise<boolean> {
  return invoke<boolean>("parakeet_model_status");
}

/** 下载模型(~640MB),进度经 Channel 实时回调。 */
export function downloadParakeetModel(
  onProgress: (p: ParakeetDownloadProgress) => void,
): Promise<void> {
  const channel = new Channel<ParakeetDownloadProgress>();
  channel.onmessage = onProgress;
  return invoke<void>("parakeet_download_model", { onProgress: channel });
}

function bytesToBase64(bytes: Uint8Array): string {
  // 分块 btoa:整块展开进单次调用会撑爆参数上限(同 transcribe.ts)。
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function startParakeetCapture(): Promise<ParakeetCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const releaseMic = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  // 尽量让浏览器直接按 16k 采集(模型采样率);WebKit 可能忽略此选项,
  // 故把实际 sampleRate 一并传给 Rust 兜底重采样。
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
  // 旧 WebKit 对悬空节点可能不跑图:经 0 增益接到输出兜底,不会外放。
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
      return invoke<string>("stt_transcribe_parakeet", {
        pcmS16leB64: bytesToBase64(pcm),
        sampleRate,
      });
    },
    cancel() {
      teardown();
    },
  };
}
