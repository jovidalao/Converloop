import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  JsonSchemaSpec,
  ModelProvider,
  Usage,
} from "./types";

// OpenAI-compatible adapter: covers OpenAI / OpenRouter / LM Studio and similar.
// HTTP uses Rust's llm_request / llm_stream (bypasses CORS + true streaming).
export interface OpenAIConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;
  /** When the endpoint can't honor response_format:json_schema (many non-OpenAI vendors: DeepSeek/Qwen/Kimi/GLM/MiniMax),
   *  downgrade json_schema requests to json_object up front and put the schema in the prompt instead. */
  jsonObjectFallback?: boolean;
}

type Body = Record<string, unknown>;

// Inline the JSON schema into the prompt as a reminder so a model answering in plain json_object mode still knows the
// exact shape. Appends to the first system message (or prepends one). Mirrors the tutor's manual fallback, applied
// centrally so every agent — not just the tutor — degrades cleanly on endpoints without json_schema support.
export function withSchemaReminder(
  messages: ChatMessage[],
  schema: JsonSchemaSpec,
): ChatMessage[] {
  const reminder = `Respond with ONE JSON object only (no markdown, no commentary). It MUST match this JSON schema:\n${JSON.stringify(schema.schema)}`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem === -1)
    return [{ role: "system", content: reminder }, ...messages];
  return messages.map((m, i) =>
    i === firstSystem ? { ...m, content: `${m.content}\n\n${reminder}` } : m,
  );
}

/** Matches the official chat/completions request body; exported for unit tests. */
export function buildBody(
  cfg: OpenAIConfig,
  opts: GenerateOptions,
  stream: boolean,
): Body {
  const body: Body = { model: cfg.model, messages: opts.messages, stream };
  // Ask for a final usage chunk on streamed responses (prompt_tokens = real context size). Endpoints that don't
  // support stream_options ignore it, and we silently fall back to the local estimate.
  if (stream) body.stream_options = { include_usage: true };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
  if (opts.jsonSchema && cfg.jsonObjectFallback) {
    // Provider can't enforce json_schema → ask for a plain JSON object and carry the schema in the prompt.
    body.response_format = { type: "json_object" };
    body.messages = withSchemaReminder(opts.messages, opts.jsonSchema);
  } else if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: opts.jsonSchema.name,
        schema: opts.jsonSchema.schema,
        strict: false,
      },
    };
  } else if (opts.jsonObject) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

/** Compatible with content / parsed / legacy text fields and similar. */
export function extractOpenAIMessageContent(json: unknown): string {
  const root = json as {
    error?: { message?: string };
    choices?: {
      message?: {
        content?: string | null;
        parsed?: unknown;
        refusal?: string | null;
      };
      text?: string;
    }[];
  };
  if (root.error?.message) throw new Error(root.error.message);

  const choice = root.choices?.[0];
  if (!choice) return "";

  const msg = choice.message;
  if (msg?.refusal) throw new Error(msg.refusal);

  if (msg?.parsed !== undefined && msg.parsed !== null) {
    return typeof msg.parsed === "string"
      ? msg.parsed
      : JSON.stringify(msg.parsed);
  }
  if (typeof msg?.content === "string" && msg.content.length > 0)
    return msg.content;
  if (typeof choice.text === "string") return choice.text;
  return msg?.content ?? "";
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

function finishReason(raw: string | null | undefined): FinishReason | null {
  if (!raw) return null;
  const kind =
    raw === "stop"
      ? "stop"
      : raw === "length"
        ? "length"
        : raw === "content_filter"
          ? "content_filter"
          : raw === "tool_calls" || raw === "function_call"
            ? "tool_use"
            : "other";
  return { kind, raw, provider: "openai" };
}

// Extract delta.content from a batch of SSE lines already split by \n, accumulate and invoke callback.
// The trailing usage chunk (choices: [], usage: {...}, emitted when stream_options.include_usage is set) carries
// prompt_tokens = the real prompt size.
export function consumeSseLines(
  lines: string[],
  onDelta: (delta: string) => void,
): { text: string; finishReason: FinishReason | null; usage?: Usage } {
  let acc = "";
  let finalReason: FinishReason | null = null;
  let usage: Usage | undefined;
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
      finalReason =
        finishReason(json.choices?.[0]?.finish_reason) ?? finalReason;
      if (json.usage?.prompt_tokens != null) {
        usage = {
          inputTokens: json.usage.prompt_tokens,
          outputTokens: json.usage.completion_tokens ?? undefined,
        };
      }
    } catch {
      // Partial JSON or keep-alive, ignore (complete line will be assembled in subsequent chunks)
    }
  }
  return { text: acc, finishReason: finalReason, usage };
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
      const content = extractOpenAIMessageContent(json);
      // Report the finish reason so callers can tell an empty response apart (length = reasoning ate the
      // token budget; content_filter = blocked; stop with empty text = endpoint ignored response_format).
      const reason = finishReason(json?.choices?.[0]?.finish_reason);
      if (reason) opts.onFinish?.(reason);
      return content;
    },

    async stream(opts, onDelta) {
      let full = "";
      let buffer = "";
      let finalReason: FinishReason | null = null;
      let usage: Usage | undefined;
      const channel = new Channel<string>();
      channel.onmessage = (chunk) => {
        buffer += chunk;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? ""; // keep the possibly-incomplete last line
        const consumed = consumeSseLines(parts, onDelta);
        full += consumed.text;
        finalReason = consumed.finishReason ?? finalReason;
        if (consumed.usage) usage = { ...usage, ...consumed.usage };
      };
      await invoke("llm_stream", {
        url,
        headers: authHeaders(cfg),
        body: buildBody(cfg, opts, true),
        onChunk: channel,
      });
      // Finalize: flush complete lines remaining in buffer (prevent missing the last chunk)
      if (buffer.trim()) {
        const consumed = consumeSseLines([buffer], onDelta);
        full += consumed.text;
        finalReason = consumed.finishReason ?? finalReason;
        if (consumed.usage) usage = { ...usage, ...consumed.usage };
      }
      if (finalReason) opts.onFinish?.(finalReason);
      if (usage) opts.onUsage?.(usage);
      return full;
    },
  };
}
