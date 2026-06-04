// Provider 无关的最小接口。agent-core 只依赖这个,不关心是 OpenAI 还是别的。
export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

// 结构化输出(导师 agent 用):name + JSON schema(由 zod-to-json-schema 生成)。
export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export type FinishReasonKind =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_use"
  | "other";

export interface FinishReason {
  kind: FinishReasonKind;
  raw: string;
  provider: "openai" | "anthropic" | "gemini";
}

export interface GenerateOptions {
  messages: ChatMessage[];
  temperature?: number;
  /** 非流式生成的输出 token 上限(导师等结构化任务建议 ≥2048)。 */
  maxTokens?: number;
  jsonSchema?: JsonSchemaSpec;
  /** 简单 JSON 模式(response_format: json_object),兼容不支持 json_schema 的端点。 */
  jsonObject?: boolean;
  /** 非功能元数据(给插件用,如日志区分是哪个 agent 在调)。provider 本身忽略它。 */
  meta?: { label?: string };
  /** provider 返回的结束原因;用于识别 max_tokens 等截断。 */
  onFinish?: (reason: FinishReason) => void;
}

export interface ModelProvider {
  generate(opts: GenerateOptions): Promise<string>;
  stream(
    opts: GenerateOptions,
    onDelta: (delta: string) => void,
  ): Promise<string>;
}
