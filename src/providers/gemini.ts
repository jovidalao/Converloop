import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  ModelProvider,
} from "./types";

// Native Gemini adapter (generateContent / streamGenerateContent).
// HTTP uses Rust's llm_request / llm_stream (same as the OpenAI adapter, generic HTTP).
export interface GeminiConfig {
  baseUrl: string; // e.g. https://generativelanguage.googleapis.com/v1beta
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

// OpenAI-style messages → Gemini contents + systemInstruction.
// Single user turn consistent with official REST examples: only contains parts, no role set; multi-turn adds user/model.
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

// JSON Schema (produced by zod-to-json-schema) → Gemini responseSchema:
// uppercase types, keep enum/required/properties/items, drop additionalProperties / $schema and other unsupported keys.
function toGeminiSchema(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  const s = node as Record<string, unknown>;

  // zod nullable() becomes anyOf:[schema,{type:"null"}]. Gemini responseSchema
  // wants the actual schema plus nullable:true; dropping anyOf leaves an empty
  // property and weakens structured output for fields like expression_gap.
  if (Array.isArray(s.anyOf)) {
    const nonNull = s.anyOf.filter(
      (item) =>
        !(
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>).type === "null"
        ),
    );
    if (nonNull.length === 1 && nonNull.length !== s.anyOf.length) {
      const mapped = toGeminiSchema(nonNull[0]);
      return mapped && typeof mapped === "object" && !Array.isArray(mapped)
        ? { ...(mapped as Record<string, unknown>), nullable: true }
        : mapped;
    }
  }

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
    out.propertyOrdering = Object.keys(props); // stable field ordering
  }
  if (Array.isArray(s.required)) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);

  return out;
}

type Body = Record<string, unknown>;

/** Matches the official generateContent request body; shared between the adapter and unit tests. */
export function buildGeminiRequestBody(opts: GenerateOptions): Body {
  const { contents, systemInstruction } = toGeminiContents(opts.messages);
  const body: Body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const generationConfig: Body = {};
  if (opts.temperature !== undefined)
    generationConfig.temperature = opts.temperature;
  if (opts.maxTokens !== undefined)
    generationConfig.maxOutputTokens = opts.maxTokens;
  if (opts.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiSchema(opts.jsonSchema.schema);
  } else if (opts.jsonObject) {
    generationConfig.responseMimeType = "application/json";
  }
  if (Object.keys(generationConfig).length > 0)
    body.generationConfig = generationConfig;
  return body;
}

function authHeaders(cfg: GeminiConfig): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey };
}

function baseModelsUrl(cfg: GeminiConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/models/${cfg.model}`;
}

/** Official REST path: …/v1beta/models/{model}:generateContent */
export function geminiGenerateUrl(cfg: GeminiConfig): string {
  return `${baseModelsUrl(cfg)}:generateContent`;
}

export function geminiStreamUrl(cfg: GeminiConfig): string {
  return `${baseModelsUrl(cfg)}:streamGenerateContent?alt=sse`;
}

function finishReason(raw: string | null | undefined): FinishReason | null {
  if (!raw) return null;
  const kind =
    raw === "MAX_TOKENS"
      ? "length"
      : raw === "STOP"
        ? "stop"
        : raw === "SAFETY" ||
            raw === "RECITATION" ||
            raw === "PROHIBITED_CONTENT" ||
            raw === "SPII"
          ? "content_filter"
          : raw === "MALFORMED_FUNCTION_CALL"
            ? "tool_use"
            : "other";
  return { kind, raw, provider: "gemini" };
}

// Extract the text from all parts of a GenerateContentResponse.
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

// Parse SSE lines already split by \n, accumulate candidates[].content.parts[].text.
function consumeSseLines(
  lines: string[],
  onDelta: (delta: string) => void,
): { text: string; finishReason: FinishReason | null } {
  let acc = "";
  let finalReason: FinishReason | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "" || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        candidates?: { finishReason?: string; content?: GeminiContent }[];
      };
      const delta = extractText(json);
      if (delta) {
        acc += delta;
        onDelta(delta);
      }
      finalReason =
        finishReason(json.candidates?.[0]?.finishReason) ?? finalReason;
    } catch {
      // Partial JSON, wait for subsequent chunks to complete it
    }
  }
  return { text: acc, finishReason: finalReason };
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
      let finalReason: FinishReason | null = null;
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        const consumed = consumeSseLines(parts, onDelta);
        full += consumed.text;
        finalReason = consumed.finishReason ?? finalReason;
      };
      await invoke("llm_stream", {
        url: geminiStreamUrl(cfg),
        headers: authHeaders(cfg),
        body: buildGeminiRequestBody(opts),
        onChunk: channel,
      });
      if (buffer.trim()) {
        const consumed = consumeSseLines([buffer], onDelta);
        full += consumed.text;
        finalReason = consumed.finishReason ?? finalReason;
      }
      if (finalReason) opts.onFinish?.(finalReason);
      return full;
    },
  };
}
