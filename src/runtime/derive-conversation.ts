// Shared layer for "conversation derivation": both built-in derivation actions (builtins) and custom
// actions (custom-agents) turn a source conversation into a new NewConversationContext. The system
// prompt wording differs on each side (builtins use ACTION/OBJECTIVE, custom injects user agent prompt),
// but the output schema, snake→camel parsing, and provider.generate call are shared here — to prevent
// silent schema drift between the two places.

import { z } from "zod";
import { toJsonSchema } from "../agents/json-schema";
import { formatZodError, parseLLMJson } from "../agents/parse-llm-json";
import type { NewConversationContext } from "../db/conversations";
import type { ChatMessage, ModelProvider } from "../providers/types";

export const NewConversationContextSchema = z.object({
  title: z.string().min(1).max(60),
  scenario: z.string().min(1),
  user_role: z.string().min(1),
  ai_role: z.string().min(1),
  difficulty: z.string().min(1),
  continuity_summary: z.string().default(""),
  opening_instruction: z.string().min(1),
  constraints: z.array(z.string()).default([]),
});

function parseNewConversationContext(raw: string): NewConversationContext {
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = NewConversationContextSchema.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(
      `Conversation derivation context validation failed: ${formatZodError(validated.error)}`,
    );
  }
  const data = validated.data;
  return {
    title: data.title,
    scenario: data.scenario,
    userRole: data.user_role,
    aiRole: data.ai_role,
    difficulty: data.difficulty,
    continuitySummary: data.continuity_summary,
    openingInstruction: data.opening_instruction,
    constraints: data.constraints,
  };
}

// Run derivation LLM: caller provides messages (their own system/user prompts) and sampling params;
// this function uniformly attaches the derivation schema, generates, and parses into NewConversationContext.
export async function generateDerivedConversation(
  provider: ModelProvider,
  messages: ChatMessage[],
  opts: { temperature: number; maxTokens: number; label: string },
): Promise<NewConversationContext> {
  const raw = await provider.generate({
    messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    jsonSchema: toJsonSchema(
      "NewConversationContext",
      NewConversationContextSchema,
    ),
    meta: { label: opts.label },
  });
  return parseNewConversationContext(raw);
}
