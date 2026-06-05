import { invoke } from "@tauri-apps/api/core";
import { base64ToArrayBuffer } from "./audio";

// 免费微软 Edge「朗读」TTS。HTTP→WebSocket 全在 Rust 侧(edge_tts_synthesize),
// 这里只把参数透传、把回传的 base64(WAV)还原成 ArrayBuffer。无需 API key。
export async function synthesizeEdge(opts: {
  text: string;
  voice: string;
  rate: string;
  pitch: string;
}): Promise<ArrayBuffer> {
  const b64 = await invoke<string>("edge_tts_synthesize", {
    text: opts.text,
    voice: opts.voice,
    rate: opts.rate,
    pitch: opts.pitch,
  });
  return base64ToArrayBuffer(b64);
}
