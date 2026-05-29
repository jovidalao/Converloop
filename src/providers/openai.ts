import { invoke, Channel } from "@tauri-apps/api/core";
import type { GenerateOptions, ModelProvider } from "./types";

// OpenAI 兼容适配器:覆盖 OpenAI / OpenRouter / LM Studio 等。
// HTTP 走 Rust 的 llm_request / llm_stream(绕过 CORS + 真流式)。
export interface OpenAIConfig {
  baseUrl: string; // 如 https://api.openai.com/v1
  apiKey: string;
  model: string;
}

type Body = Record<string, unknown>;

function buildBody(cfg: OpenAIConfig, opts: GenerateOptions, stream: boolean): Body {
  const body: Body = { model: cfg.model, messages: opts.messages, stream };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: opts.jsonSchema.name,
        schema: opts.jsonSchema.schema,
        strict: true,
      },
    };
  }
  return body;
}

function authHeaders(cfg: OpenAIConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
  };
}

function endpoint(cfg: OpenAIConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

// 从一批已按 \n 切好的 SSE 行里抽取 delta.content,累加并回调。
function consumeSseLines(
  lines: string[],
  onDelta: (delta: string) => void,
): string {
  let acc = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "" || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data);
      const delta: string | undefined = json.choices?.[0]?.delta?.content;
      if (delta) {
        acc += delta;
        onDelta(delta);
      }
    } catch {
      // 半截 JSON 或 keep-alive,忽略(完整行会在后续 chunk 拼齐)
    }
  }
  return acc;
}

export function createOpenAIProvider(cfg: OpenAIConfig): ModelProvider {
  const url = endpoint(cfg);
  return {
    async generate(opts) {
      const text = await invoke<string>("llm_request", {
        url,
        headers: authHeaders(cfg),
        body: buildBody(cfg, opts, false),
      });
      const json = JSON.parse(text);
      return json.choices?.[0]?.message?.content ?? "";
    },

    async stream(opts, onDelta) {
      let full = "";
      let buffer = "";
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? ""; // 留下可能不完整的最后一行
        full += consumeSseLines(parts, onDelta);
      };
      await invoke("llm_stream", {
        url,
        headers: authHeaders(cfg),
        body: buildBody(cfg, opts, true),
        onChunk: channel,
      });
      // 收尾:flush 残留 buffer 里的完整行(防止漏掉最后一块)
      if (buffer.trim()) full += consumeSseLines([buffer], onDelta);
      return full;
    },
  };
}
