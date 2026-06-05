import { invoke } from "@tauri-apps/api/core";
import { base64ToArrayBuffer } from "./audio";

export async function synthesizeMimo(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  stylePrompt: string;
  text: string;
}): Promise<ArrayBuffer> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: opts.model,
    messages: [
      { role: "user", content: opts.stylePrompt },
      { role: "assistant", content: opts.text },
    ],
    audio: {
      format: "wav",
      voice: opts.voice,
    },
  };

  const respText = await invoke<string>("llm_request", {
    url,
    headers: {
      "Content-Type": "application/json",
      "api-key": opts.apiKey,
    },
    body,
  });

  const json = JSON.parse(respText) as {
    choices?: { message?: { audio?: { data?: string } } }[];
  };
  const b64 = json.choices?.[0]?.message?.audio?.data;
  if (!b64) throw new Error("MiMo TTS 响应中没有音频数据");
  return base64ToArrayBuffer(b64);
}
