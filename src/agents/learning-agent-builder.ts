import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DATA_SCOPE_LABELS,
  LEARNING_DATA_SCOPE_VALUES,
  type LearningAgentDraft,
} from "../db/learning-agents";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { formatZodError, parseLLMJson } from "./parse-llm-json";

const GeneratedLearningAgent = z.object({
  name: z.string().min(1).max(24),
  description: z.string().min(1).max(80),
  prompt: z.string().min(80),
  data_scopes: z.array(z.enum(LEARNING_DATA_SCOPE_VALUES)).min(1),
});

function jsonSchema(): { name: string; schema: Record<string, unknown> } {
  const schema = zodToJsonSchema(GeneratedLearningAgent, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: "GeneratedLearningAgent", schema };
}

function scopeList(): string {
  return LEARNING_DATA_SCOPE_VALUES.map(
    (scope) => `- ${scope}: ${DATA_SCOPE_LABELS[scope]}`,
  ).join("\n");
}

function systemPrompt(ctx: {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
}): string {
  return `You design one reusable customized learning agent for a desktop language-learning app.
The learner is a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at roughly ${ctx.level} level.

The app already supplies a base teacher prompt. Your job is to create ONLY the custom lesson layer:
- a short name,
- a one-sentence description,
- a precise custom prompt telling the teacher what to do,
- which data scopes the agent needs.

Available data scopes:
${scopeList()}

Rules:
- Choose only from the listed data scopes.
- The prompt must not claim access to unlisted data.
- The prompt should make the session interactive: explain briefly, then ask the learner to produce something.
- Use ${ctx.nativeLanguage} for explanations when useful and ${ctx.targetLanguage} for examples/drills.
- Return only the JSON object matching the schema.`;
}

export async function generateLearningAgentDraft(
  provider: ModelProvider,
  description: string,
  ctx: { nativeLanguage: string; targetLanguage: string; level: string },
): Promise<LearningAgentDraft> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    {
      role: "user",
      content: `Create a learning agent from this natural-language request:\n${description}`,
    },
  ];
  const schema = jsonSchema();
  const raw = await provider.generate({
    messages,
    temperature: 0.2,
    maxTokens: 2048,
    jsonSchema: schema,
    meta: { label: "learning_agent_builder" },
  });
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = GeneratedLearningAgent.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(
      `学习 Agent 生成结果校验失败: ${formatZodError(validated.error)}`,
    );
  }
  return {
    name: validated.data.name,
    description: validated.data.description,
    prompt: validated.data.prompt,
    dataScopes: [...validated.data.data_scopes],
  };
}
