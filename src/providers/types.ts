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

export interface GenerateOptions {
  messages: ChatMessage[];
  temperature?: number;
  jsonSchema?: JsonSchemaSpec;
  /** 简单 JSON 模式(response_format: json_object),兼容不支持 json_schema 的端点。 */
  jsonObject?: boolean;
}

export interface ModelProvider {
  generate(opts: GenerateOptions): Promise<string>;
  stream(opts: GenerateOptions, onDelta: (delta: string) => void): Promise<string>;
}
