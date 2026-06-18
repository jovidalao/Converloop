// AudioWorklet: buffers microphone Float32 mono frames into ~85ms (4096 sample)
// s16le PCM chunks and posts them to the main thread for Soniox real-time WS
// streaming and local STT. It runs on the audio thread, so React work on the main
// thread does not drop audio. CSP script-src 'self' forbids blob: modules, so this
// lives in public/ and loads as a static file.
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
