// 「对话衍生」的共享层:内置衍生动作(builtins)和自定义 action(custom-agents)
// 都把一段源对话变成一个新的 NewConversationContext。两边的 system prompt 措辞不同
// (内置走 ACTION/OBJECTIVE,自定义注入用户 agent prompt),但输出 schema、snake→camel
// 解析、provider.generate 调用是同一套 —— 收在这里,避免两处 schema 静默漂移。

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
      `对话衍生上下文校验失败: ${formatZodError(validated.error)}`,
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

// 跑衍生 LLM:调用方自带 messages(各自的 system/user prompt)与采样参数,
// 这里统一挂衍生 schema、生成、解析成 NewConversationContext。
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
