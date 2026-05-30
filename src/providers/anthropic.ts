import { invoke, Channel } from "@tauri-apps/api/core";
import type { ChatMessage, GenerateOptions, ModelProvider } from "./types";

// 原生 Anthropic Messages API。结构化输出走 tool_use + input_schema。
export interface AnthropicConfig {
  baseUrl: string; // 如 https://api.anthropic.com/v1
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export const ANTHROPIC_API_VERSION = "2023-06-01";

interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

/** OpenAI 风格 messages → Anthropic system + messages。稳定 system 段打 cache 断点。 */
export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: SystemBlock[];
  messages: AnthropicMessage[];
} {
  const systemTexts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemTexts.push(m.content);
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }

  const system = systemTexts.length
    ? [
        {
          type: "text" as const,
          text: systemTexts.join("\n\n"),
          cache_control: { type: "ephemeral" as const },
        },
      ]
    : undefined;

  return { system, messages: out };
}

type Body = Record<string, unknown>;

/** 与官方 POST /v1/messages 请求体一致;供适配器与单测共用。 */
export function buildAnthropicRequestBody(
  cfg: AnthropicConfig,
  opts: GenerateOptions,
  stream: boolean,
): Body {
  const { system, messages } = toAnthropicMessages(opts.messages);
  const body: Body = {
    model: cfg.model,
    max_tokens: opts.maxTokens ?? cfg.maxTokens ?? 4096,
    messages,
    stream,
  };
  if (system) body.system = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  if (opts.jsonSchema) {
    body.tools = [
      {
        name: opts.jsonSchema.name,
        description: `Structured output: ${opts.jsonSchema.name}`,
        input_schema: opts.jsonSchema.schema,
      },
    ];
    body.tool_choice = { type: "tool", name: opts.jsonSchema.name };
  }

  return body;
}

export function anthropicMessagesUrl(cfg: AnthropicConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/messages`;
}

function authHeaders(cfg: AnthropicConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
  };
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string }
  | { type: "redacted_thinking" }
  | { type: "tool_use"; name: string; input: unknown };

/** 从 Messages 响应抽取文本;tool_use 时返回 JSON 字符串(供导师 agent 解析)。 */
export function extractAnthropicContent(json: unknown): string {
  const res = json as {
    error?: { message?: string };
    type?: string;
    stop_reason?: string;
    content?: ContentBlock[];
  };
  if (res.error?.message) throw new Error(res.error.message);

  const blocks = res.content ?? [];
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "thinking" || block.type === "redacted_thinking") continue;
    if (block.type === "text") texts.push(block.text);
    if (block.type === "tool_use") {
      return JSON.stringify(block.input);
    }
  }
  return texts.join("");
}

function consumeAnthropicSseLines(
  lines: string[],
  onDelta: (delta: string) => void,
): string {
  let acc = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (
        json.type === "content_block_delta" &&
        json.delta?.type === "text_delta"
      ) {
        const text = json.delta.text ?? "";
        if (text) {
          acc += text;
          onDelta(text);
        }
      }
    } catch {
      // 半截 JSON,等后续 chunk 拼齐
    }
  }
  return acc;
}

export function createAnthropicProvider(cfg: AnthropicConfig): ModelProvider {
  const url = anthropicMessagesUrl(cfg);
  return {
    async generate(opts) {
      const text = await invoke<string>("llm_request", {
        url,
        headers: authHeaders(cfg),
        body: buildAnthropicRequestBody(cfg, opts, false),
      });
      return extractAnthropicContent(JSON.parse(text));
    },

    async stream(opts, onDelta) {
      let full = "";
      let buffer = "";
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        full += consumeAnthropicSseLines(parts, onDelta);
      };
      await invoke("llm_stream", {
        url,
        headers: authHeaders(cfg),
        body: buildAnthropicRequestBody(cfg, opts, true),
        onChunk: channel,
      });
      if (buffer.trim()) full += consumeAnthropicSseLines([buffer], onDelta);
      return full;
    },
  };
}
