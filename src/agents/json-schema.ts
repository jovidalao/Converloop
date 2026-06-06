import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Convert a Zod schema to a JSON schema for provider structured output: inline refs
// ($refStrategy:"none"), strip $schema — so OpenAI-compatible endpoints can consume it directly.
// See docs/architecture.md pitfall notes (zod pinned at v3). Shared by all agents.
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
