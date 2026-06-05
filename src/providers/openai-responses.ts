import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  ModelProvider,
} from "./types";

// OpenAI Codex(ChatGPT 订阅登录)适配器:走 Responses API,而非 chat/completions。
// 端点 https://chatgpt.com/backend-api/codex/responses,body 用 instructions+input、store:false,
// SSE 事件是 response.output_text.delta / response.completed(核对自 openclaw)。
// HTTP 仍复用 Rust 的 llm_stream(JSON POST + 流式),只是 TS 侧按 Responses 事件解析。
export interface OpenAICodexConfig {
  baseUrl: string; // 如 https://chatgpt.com/backend-api
  apiKey: string; // 订阅 access token(JWT)
  model: string;
  accountId?: string; // 从 access JWT 解出的 chatgpt_account_id
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

/** system → 顶层 instructions;user/assistant → Responses input 条目(content 用带类型的块)。 */
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

function buildBody(cfg: OpenAICodexConfig, opts: GenerateOptions): Body {
  const { instructions, input } = splitMessages(opts.messages);
  const body: Body = {
    model: cfg.model,
    store: false, // Codex 后端强制:store 必须 false
    stream: true, // 后端只支持流式;generate 内部累加
    instructions,
    input,
  };
  // 结构化输出走 Responses 的 text.format。
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
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_output_tokens = opts.maxTokens;
  return body;
}

function finishFromType(type: string): FinishReason {
  return {
    kind: type === "response.incomplete" ? "length" : "stop",
    raw: type,
    provider: "openai",
  };
}

// 从已按 \n 切好的 SSE 行抽取 Responses 事件:累加 output_text.delta,记结束/错误。
// 每条 data: 行本身是完整事件 JSON(带 type 字段),逐行解析即可。
function consumeResponsesSseLines(
  lines: string[],
  onDelta: (delta: string) => void,
): { text: string; finishReason: FinishReason | null; error?: string } {
  let acc = "";
  let finalReason: FinishReason | null = null;
  let error: string | undefined;
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
        response?: { error?: { message?: string } };
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
      } else if (ev.type === "response.failed" || ev.type === "error") {
        error = ev.response?.error?.message ?? ev.message ?? "Codex 响应失败";
      }
    } catch {
      // 半截 JSON,等后续 chunk 拼齐
    }
  }
  return { text: acc, finishReason: finalReason, error };
}

// 发一次流式请求,逐块解析;generate / stream 共用(generate 传空 onDelta)。
async function runStream(
  url: string,
  cfg: OpenAICodexConfig,
  opts: GenerateOptions,
  onDelta: (delta: string) => void,
): Promise<{ full: string; finishReason: FinishReason | null }> {
  let full = "";
  let buffer = "";
  let finalReason: FinishReason | null = null;
  let error: string | undefined;
  const channel = new Channel<string>();
  channel.onmessage = (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    const c = consumeResponsesSseLines(parts, onDelta);
    full += c.text;
    finalReason = c.finishReason ?? finalReason;
    error = c.error ?? error;
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
  }
  if (error) throw new Error(error);
  return { full, finishReason: finalReason };
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
      const { full, finishReason } = await runStream(url, cfg, opts, onDelta);
      if (finishReason) opts.onFinish?.(finishReason);
      return full;
    },
  };
}
