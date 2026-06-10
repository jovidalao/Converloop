// AudioWorklet:把麦克风的 Float32 单声道帧攒成 ~85ms(4096 样本)的
// s16le PCM 块发回主线程(供 Soniox 实时 WS 推流)。跑在音频线程,
// 主线程被 React 渲染占住也不丢音频。CSP script-src 'self' 禁 blob: 模块,
// 所以放 public/ 以静态文件加载。
const CHUNK_SAMPLES = 4096;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffers = [];
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.buffers.push(channel.slice());
      this.length += channel.length;
      if (this.length >= CHUNK_SAMPLES) {
        const all = new Float32Array(this.length);
        let offset = 0;
        for (const buf of this.buffers) {
          all.set(buf, offset);
          offset += buf.length;
        }
        const pcm = new Int16Array(all.length);
        for (let i = 0; i < all.length; i++) {
          const s = Math.max(-1, Math.min(1, all[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.buffers = [];
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
