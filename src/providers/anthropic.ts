import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  ModelProvider,
  Usage,
} from "./types";

// Native Anthropic Messages API. Structured output uses tool_use + input_schema.
export interface AnthropicConfig {
  baseUrl: string; // e.g. https://api.anthropic.com/v1
  apiKey: string;
  model: string;
  maxTokens?: number;
  /** Subscription login (Claude Pro/Max) mode: apiKey is an sk-ant-oat… access token, uses Bearer + Claude Code identity headers. */
  oauth?: boolean;
}

export const ANTHROPIC_API_VERSION = "2023-06-01";

// OAuth tokens require the request to "look like Claude Code": the first system block must be this identity declaration, with these headers (verified against openclaw).
const OAUTH_SYSTEM_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";
const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.75";

interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

/** OpenAI-style messages → Anthropic system + messages. Stable system section gets a cache breakpoint. */
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

function modelRejectsSamplingParams(model: string): boolean {
  const match = model
    .toLowerCase()
    .trim()
    .match(/^claude-opus-4-(\d+)(?:\b|-)/);
  return match ? Number.parseInt(match[1], 10) >= 7 : false;
}

/** Matches the official POST /v1/messages request body; shared between the adapter and unit tests. */
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
  if (cfg.oauth) {
    // Subscription token requires the first system block to be the Claude Code identity declaration, otherwise the server rejects the request.
    body.system = [
      { type: "text", text: OAUTH_SYSTEM_IDENTITY },
      ...(system ?? []),
    ];
  } else if (system) {
    body.system = system;
  }
  if (
    opts.temperature !== undefined &&
    !modelRejectsSamplingParams(cfg.model)
  ) {
    body.temperature = opts.temperature;
  }

  if (opts.jsonSchema) {
    body.tools = [
      {
        name: opts.jsonSchema.name,
        description: `Structured output: ${opts.jsonSchema.name}`,
        input_schema: opts.jsonSchema.schema,
      },
    ];
    body.tool_choice = { type: "tool", name: opts.jsonSchema.name };
  } else if (opts.jsonObject) {
    const name = "JsonResponse";
    body.tools = [
      {
        name,
        description: "Structured JSON object response",
        input_schema: {
          type: "object",
          additionalProperties: true,
        },
      },
    ];
    body.tool_choice = { type: "tool", name };
  }

  return body;
}

export function anthropicMessagesUrl(cfg: AnthropicConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/messages`;
}

export function authHeaders(cfg: AnthropicConfig): Record<string, string> {
  if (cfg.oauth) {
    // Subscription token: Bearer auth + Claude Code identity headers, no x-api-key sent.
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
      "User-Agent": CLAUDE_CODE_USER_AGENT,
    };
  }
  return {
    "Content-Type": "application/json",
    "x-api-key": cfg.apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
  };
}

function finishReason(raw: string | null | undefined): FinishReason | null {
  if (!raw) return null;
  const kind =
    raw === "max_tokens"
      ? "length"
      : raw === "end_turn" || raw === "stop_sequence"
        ? "stop"
        : raw === "tool_use"
          ? "tool_use"
          : "other";
  return { kind, raw, provider: "anthropic" };
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string }
  | { type: "redacted_thinking" }
  | { type: "tool_use"; name: string; input: unknown };

/** Extract text from a Messages response; returns a JSON string for tool_use (for the tutor agent to parse). */
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
    if (block.type === "thinking" || block.type === "redacted_thinking")
      continue;
    if (block.type === "text") texts.push(block.text);
    if (block.type === "tool_use") {
      return JSON.stringify(block.input);
    }
  }
  return texts.join("");
}

// Sum every input bucket Anthropic reports: on a cache hit, input_tokens covers only the uncached tail and the bulk
// sits in cache_read/cache_creation. Summing keeps inputTokens the true context size instead of undercounting.
interface AnthropicUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}
function totalInputTokens(u: AnthropicUsage): number {
  return (
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  );
}

export function consumeAnthropicSseLines(
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
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        type?: string;
        message?: { usage?: AnthropicUsage };
        usage?: AnthropicUsage;
        delta?: { type?: string; text?: string; stop_reason?: string | null };
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
      // message_start carries input_tokens (+ cache buckets); message_delta carries the final output_tokens.
      if (json.type === "message_start" && json.message?.usage) {
        usage = { ...usage, inputTokens: totalInputTokens(json.message.usage) };
      }
      if (json.type === "message_delta") {
        finalReason = finishReason(json.delta?.stop_reason) ?? finalReason;
        if (json.usage?.output_tokens != null)
          usage = { ...usage, outputTokens: json.usage.output_tokens };
      }
    } catch {
      // Partial JSON, wait for subsequent chunks to complete it
    }
  }
  return { text: acc, finishReason: finalReason, usage };
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
      const json = JSON.parse(text) as { stop_reason?: string };
      const content = extractAnthropicContent(json);
      // Surface the stop reason so callers can detect max_tokens truncation (empty text on reasoning models).
      const reason = finishReason(json.stop_reason);
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
        buffer = parts.pop() ?? "";
        const consumed = consumeAnthropicSseLines(parts, onDelta);
        full += consumed.text;
        finalReason = consumed.finishReason ?? finalReason;
        if (consumed.usage) usage = { ...usage, ...consumed.usage };
      };
      await invoke("llm_stream", {
        url,
        headers: authHeaders(cfg),
        body: buildAnthropicRequestBody(cfg, opts, true),
        onChunk: channel,
      });
      if (buffer.trim()) {
        const consumed = consumeAnthropicSseLines([buffer], onDelta);
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
