import { invoke, Channel } from "@tauri-apps/api/core";
import type { ChatMessage, GenerateOptions, ModelProvider } from "./types";

// 原生 Gemini 适配器(generateContent / streamGenerateContent)。
// HTTP 走 Rust 的 llm_request / llm_stream(同 OpenAI 适配器,通用 HTTP)。
export interface GeminiConfig {
  baseUrl: string; // 如 https://generativelanguage.googleapis.com/v1beta
  apiKey: string;
  model: string;
}

interface GeminiPart {
  text?: string;
}
interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}

// OpenAI 风格 messages → Gemini contents + systemInstruction。
// 单条 user 与官方 REST 样例一致:只含 parts、不设 role;多轮再补 user/model。
function toGeminiContents(messages: ChatMessage[]): {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
} {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemTexts.push(m.content);
      continue;
    }
    const entry: GeminiContent = { parts: [{ text: m.content }] };
    if (m.role === "assistant") {
      entry.role = "model";
    } else if (contents.length > 0) {
      entry.role = "user";
    }
    contents.push(entry);
  }
  const systemInstruction = systemTexts.length
    ? { parts: [{ text: systemTexts.join("\n\n") }] }
    : undefined;
  return { contents, systemInstruction };
}

const TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

// JSON Schema(zod-to-json-schema 产出)→ Gemini responseSchema:
// 类型大写、保留 enum/required/properties/items、丢掉 additionalProperties / $schema 等不支持键。
function toGeminiSchema(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  const s = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof s.type === "string") {
    out.type = TYPE_MAP[s.type] ?? s.type.toUpperCase();
  }
  if (typeof s.description === "string") out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum;

  if (s.properties && typeof s.properties === "object") {
    const props = s.properties as Record<string, unknown>;
    const mapped: Record<string, unknown> = {};
    for (const k of Object.keys(props)) mapped[k] = toGeminiSchema(props[k]);
    out.properties = mapped;
    out.propertyOrdering = Object.keys(props); // 稳定字段顺序
  }
  if (Array.isArray(s.required)) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);

  return out;
}

type Body = Record<string, unknown>;

/** 与官方 generateContent 请求体一致;供适配器与单测共用。 */
export function buildGeminiRequestBody(opts: GenerateOptions): Body {
  const { contents, systemInstruction } = toGeminiContents(opts.messages);
  const body: Body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const generationConfig: Body = {};
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) generationConfig.maxOutputTokens = opts.maxTokens;
  if (opts.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(opts.jsonSchema.schema);
  } else if (opts.jsonObject) {
    generationConfig.responseMimeType = "application/json";
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  return body;
}

function authHeaders(cfg: GeminiConfig): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey };
}

function baseModelsUrl(cfg: GeminiConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/models/${cfg.model}`;
}

/** 官方 REST 路径:…/v1beta/models/{model}:generateContent */
export function geminiGenerateUrl(cfg: GeminiConfig): string {
  return `${baseModelsUrl(cfg)}:generateContent`;
}

export function geminiStreamUrl(cfg: GeminiConfig): string {
  return `${baseModelsUrl(cfg)}:streamGenerateContent?alt=sse`;
}

// 从一个 GenerateContentResponse 里抽出所有 parts 的 text。
function extractText(json: unknown): string {
  const res = json as {
    error?: { message?: string };
    candidates?: { content?: GeminiContent }[];
    promptFeedback?: { blockReason?: string };
  };
  if (res.error?.message) throw new Error(res.error.message);
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  if (parts.length === 0 && res.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${res.promptFeedback.blockReason}`);
  }
  return parts.map((p) => p.text ?? "").join("");
}

// 解析已按 \n 切好的 SSE 行,累加 candidates[].content.parts[].text。
function consumeSseLines(lines: string[], onDelta: (delta: string) => void): string {
  let acc = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "" || data === "[DONE]") continue;
    try {
      const delta = extractText(JSON.parse(data));
      if (delta) {
        acc += delta;
        onDelta(delta);
      }
    } catch {
      // 半截 JSON,等后续 chunk 拼齐
    }
  }
  return acc;
}

export function createGeminiProvider(cfg: GeminiConfig): ModelProvider {
  return {
    async generate(opts) {
      const text = await invoke<string>("llm_request", {
        url: geminiGenerateUrl(cfg),
        headers: authHeaders(cfg),
        body: buildGeminiRequestBody(opts),
      });
      return extractText(JSON.parse(text));
    },

    async stream(opts, onDelta) {
      let full = "";
      let buffer = "";
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        full += consumeSseLines(parts, onDelta);
      };
      await invoke("llm_stream", {
        url: geminiStreamUrl(cfg),
        headers: authHeaders(cfg),
        body: buildGeminiRequestBody(opts),
        onChunk: channel,
      });
      if (buffer.trim()) full += consumeSseLines([buffer], onDelta);
      return full;
    },
  };
}
