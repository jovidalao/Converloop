import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// 把 Zod schema 转成喂 provider 结构化输出的 JSON schema:inline refs
// ($refStrategy:"none")、去掉 $schema —— 让 OpenAI 兼容端点能直接吃。
// 见 docs/architecture.md 踩坑记录(zod 钉 v3)。所有 agent 共用此处一份。
export function toJsonSchema(
  name: string,
  schema: ZodTypeAny,
): { name: string; schema: Record<string, unknown> } {
  const raw = zodToJsonSchema(schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete raw.$schema;
  return { name, schema: raw };
}
