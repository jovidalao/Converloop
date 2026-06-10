import { invoke } from "@tauri-apps/api/core";
import { loadConfig } from "../config";
import {
  getSttApiKey,
  languageHintsFor,
  loadSttConfig,
  MissingSttApiKeyError,
} from "./config";

// HTTP goes through Rust (multipart upload, bypasses webview CORS), same as the
// LLM calls. Soniox gets language hints from the learner's native + target
// languages (mixed input is a core flow); the OpenAI path stays unhinted and
// relies on the endpoint's auto-detection.
export async function transcribeAudio(
  blob: Blob,
  mime: string,
): Promise<string> {
  const config = loadSttConfig();
  const apiKey = await getSttApiKey(config.sttProvider);
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

  if (config.sttProvider === "soniox") {
    const app = loadConfig();
    const text = await invoke<string>("stt_transcribe_soniox", {
      apiKey,
      model: config.sonioxModel,
      audioB64,
      mime,
      fileName,
      languageHints: languageHintsFor([app.targetLanguage, app.nativeLanguage]),
    });
    return text.trim();
  }

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
