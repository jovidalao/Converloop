import { invoke } from "@tauri-apps/api/core";
import { base64ToArrayBuffer } from "./audio";

// Free Microsoft Edge "Read Aloud" TTS. The full HTTP→WebSocket flow runs on the Rust side (edge_tts_synthesize);
// here we only forward parameters and convert the returned base64 (WAV) back into an ArrayBuffer. No API key required.
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
