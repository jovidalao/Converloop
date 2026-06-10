import { invoke } from "@tauri-apps/api/core";
import { getSttApiKey, loadSttConfig, MissingSttApiKeyError } from "./config";

// OpenAI 兼容引擎的批量转写(录完整段再上传)。HTTP 走 Rust(multipart,
// 绕 webview CORS),与 LLM 调用同理;不固定 language,靠端点自检——母语/
// 混说输入是核心链路。Soniox 走实时流式,见 realtime.ts。
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
