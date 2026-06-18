import { invoke } from "@tauri-apps/api/core";
import { getSttApiKey, loadSttConfig, MissingSttApiKeyError } from "./config";

// Batch transcription for OpenAI-compatible engines (record the whole utterance,
// then upload). HTTP goes through Rust multipart to bypass webview CORS, like LLM
// calls. Do not pin a language; native/mixed-language input is core, so let the
// endpoint detect it. Soniox uses real-time streaming; see realtime.ts.
export async function transcribeAudio(
  blob: Blob,
  mime: string,
): Promise<string> {
  const config = loadSttConfig();
  const apiKey = await getSttApiKey("openai");
  if (!apiKey) throw new MissingSttApiKeyError();

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // btoa over chunks: spreading the whole buffer into one call overflows the arg limit.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const audioB64 = btoa(binary);
  const ext = mime.includes("mp4")
    ? "m4a"
    : mime.includes("webm")
      ? "webm"
      : "wav";
  const fileName = `speech.${ext}`;

  const text = await invoke<string>("stt_transcribe", {
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
    audioB64,
    mime,
    fileName,
  });
  return text.trim();
}
