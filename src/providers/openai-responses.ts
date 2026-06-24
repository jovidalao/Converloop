import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  ModelProvider,
  Usage,
} from "./types";

// OpenAI Codex (ChatGPT subscription login) adapter: uses the Responses API, not chat/completions.
// Endpoint https://chatgpt.com/backend-api/codex/responses, body uses instructions+input, store:false,
// SSE events are response.output_text.delta / response.completed (verified against openclaw).
// HTTP still reuses Rust's llm_stream (JSON POST + streaming), only the TS side parses Responses events.
export interface OpenAICodexConfig {
  baseUrl: string; // e.g. https://chatgpt.com/backend-api
  apiKey: string; // subscription access token (JWT)
  model: string;
  accountId?: string; // chatgpt_account_id decoded from the access JWT
}

const ORIGINATOR = "codex_cli_rs";
const USER_AGENT = "codex_cli_rs/0.21.0";

type Body = Record<string, unknown>;

function codexUrl(baseUrl: string): string {
  const n = baseUrl.replace(/\/+$/, "");
  if (n.endsWith("/codex/responses")) return n;
  if (n.endsWith("/codex")) return `${n}/responses`;
  return `${n}/codex/responses`;
}

function authHeaders(cfg: OpenAICodexConfig): Record<string, string> {
  const requestId = crypto.randomUUID();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "OpenAI-Beta": "responses=experimental",
    originator: ORIGINATOR,
    "User-Agent": USER_AGENT,
    accept: "text/event-stream",
    session_id: requestId,
    "x-client-request-id": requestId,
  };
  if (cfg.accountId) headers["chatgpt-account-id"] = cfg.accountId;
  return headers;
}

/** system → top-level instructions; user/assistant → Responses input entries (content uses typed blocks). */
function splitMessages(messages: ChatMessage[]): {
  instructions: string;
  input: unknown[];
} {
  const systemTexts: string[] = [];
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemTexts.push(m.content);
      continue;
    }
    const partType = m.role === "assistant" ? "output_text" : "input_text";
    input.push({
      type: "message",
      role: m.role,
      content: [{ type: partType, text: m.content }],
    });
  }
  return {
    instructions: systemTexts.join("\n\n") || "You are a helpful assistant.",
    input,
  };
}

export function buildBody(cfg: OpenAICodexConfig, opts: GenerateOptions): Body {
  const { instructions, input } = splitMessages(opts.messages);
  const body: Body = {
    model: cfg.model,
    store: false, // Codex backend enforces: store must be false
    stream: true, // backend only supports streaming; generate accumulates internally
    instructions,
    input,
  };
  // Structured output uses Responses' text.format.
  if (opts.jsonSchema) {
    body.text = {
      format: {
        type: "json_schema",
        name: opts.jsonSchema.name,
        schema: opts.jsonSchema.schema,
        strict: false,
      },
    };
  } else if (opts.jsonObject) {
    body.text = { format: { type: "json_object" } };
  }
  return body;
}

function finishFromType(type: string): FinishReason {
  return {
    kind: type === "response.incomplete" ? "length" : "stop",
    raw: type,
    provider: "openai",
  };
}

// Extract Responses events from SSE lines already split by \n: accumulate output_text.delta, record completion/errors.
// Each data: line is a complete event JSON (with a type field), parse line by line.
function consumeResponsesSseLines(
  lines: string[],
  onDelta: (delta: string) => void,
): {
  text: string;
  finishReason: FinishReason | null;
  error?: string;
  usage?: Usage;
} {
  let acc = "";
  let finalReason: FinishReason | null = null;
  let error: string | undefined;
  let usage: Usage | undefined;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const ev = JSON.parse(data) as {
        type?: string;
        delta?: string;
        message?: string;
        response?: {
          error?: { message?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      };
      if (ev.type === "response.output_text.delta") {
        const d = ev.delta ?? "";
        if (d) {
          acc += d;
          onDelta(d);
        }
      } else if (
        ev.type === "response.completed" ||
        ev.type === "response.incomplete" ||
        ev.type === "response.done"
      ) {
        finalReason = finishFromType(ev.type);
        // The terminal event carries the final usage on its response object.
        if (ev.response?.usage?.input_tokens != null)
          usage = {
            inputTokens: ev.response.usage.input_tokens,
            outputTokens: ev.response.usage.output_tokens ?? undefined,
          };
      } else if (ev.type === "response.failed" || ev.type === "error") {
        error =
          ev.response?.error?.message ?? ev.message ?? "Codex response failed";
      }
    } catch {
      // Partial JSON, wait for subsequent chunks to complete it
    }
  }
  return { text: acc, finishReason: finalReason, error, usage };
}

// Send one streaming request, parse chunk by chunk; shared by generate / stream (generate passes a no-op onDelta).
async function runStream(
  url: string,
  cfg: OpenAICodexConfig,
  opts: GenerateOptions,
  onDelta: (delta: string) => void,
): Promise<{
  full: string;
  finishReason: FinishReason | null;
  usage?: Usage;
}> {
  let full = "";
  let buffer = "";
  let finalReason: FinishReason | null = null;
  let error: string | undefined;
  let usage: Usage | undefined;
  const channel = new Channel<string>();
  channel.onmessage = (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    const c = consumeResponsesSseLines(parts, onDelta);
    full += c.text;
    finalReason = c.finishReason ?? finalReason;
    error = c.error ?? error;
    if (c.usage) usage = { ...usage, ...c.usage };
  };
  await invoke("llm_stream", {
    url,
    headers: authHeaders(cfg),
    body: buildBody(cfg, opts),
    onChunk: channel,
  });
  if (buffer.trim()) {
    const c = consumeResponsesSseLines([buffer], onDelta);
    full += c.text;
    finalReason = c.finishReason ?? finalReason;
    error = c.error ?? error;
    if (c.usage) usage = { ...usage, ...c.usage };
  }
  if (error) throw new Error(error);
  return { full, finishReason: finalReason, usage };
}

export function createOpenAICodexProvider(
  cfg: OpenAICodexConfig,
): ModelProvider {
  const url = codexUrl(cfg.baseUrl);
  return {
    async generate(opts) {
      return (await runStream(url, cfg, opts, () => {})).full;
    },
    async stream(opts, onDelta) {
      const { full, finishReason, usage } = await runStream(
        url,
        cfg,
        opts,
        onDelta,
      );
      if (finishReason) opts.onFinish?.(finishReason);
      if (usage) opts.onUsage?.(usage);
      return full;
    },
  };
}
