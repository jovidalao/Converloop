import { z } from "zod";
import {
  DATA_SCOPE_LABELS,
  LEARNING_DATA_SCOPE_VALUES,
  type LearningAgentDraft,
} from "../db/learning-agents";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { toJsonSchema } from "./json-schema";
import { formatZodError, parseLLMJson } from "./parse-llm-json";

const SuggestedLesson = z.object({
  name: z.string().min(1).max(24),
  description: z.string().min(1).max(80),
  prompt: z.string().min(80),
  data_scopes: z.array(z.enum(LEARNING_DATA_SCOPE_VALUES)).min(1),
});

export const GeneratedLearningProject = z.object({
  title: z.string().min(1).max(40),
  goal: z.string().min(1).max(300),
  plan_markdown: z.string().min(1),
  notes_markdown: z.string().optional(),
  suggested_lessons: z.array(SuggestedLesson).max(3),
  next_actions: z.array(z.string()).max(6),
});

export type GeneratedLearningProject = z.infer<typeof GeneratedLearningProject>;

export interface LearningProjectPlan {
  title: string;
  goal: string;
  planMarkdown: string;
  notesMarkdown: string;
  suggestedLessons: LearningAgentDraft[];
  nextActions: string[];
  raw: GeneratedLearningProject;
}

export function learningProjectJsonSchema(): {
  name: string;
  schema: Record<string, unknown>;
} {
  return toJsonSchema("GeneratedLearningProject", GeneratedLearningProject);
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
  return `You are a bounded task-planning agent for a desktop language-learning app.
The learner is a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at roughly ${ctx.level} level.

Your job is to turn a broad learning need into:
- one concrete learning project,
- a readable study plan,
- up to 3 reusable customized lesson agents that the app can create.

Available data scopes for suggested lesson agents:
${scopeList()}

Hard boundaries:
- Return JSON only.
- Do not ask to directly edit mastery counts, hidden app state, files, settings, or API keys.
- Do not claim tool access. Suggested lessons may only read the listed learning data scopes.
- Keep the plan practical for chat-based language learning, not flashcards or a full LMS.
- Use ${ctx.nativeLanguage} for project planning notes; use ${ctx.targetLanguage} for examples or drills where useful.
- Each suggested lesson prompt must be interactive: explain briefly, ask the learner to produce language, and give feedback in chat.
- If the user request is broad, create a staged plan instead of trying to solve everything in one lesson.`;
}

export async function planLearningProject(
  provider: ModelProvider,
  description: string,
  ctx: { nativeLanguage: string; targetLanguage: string; level: string },
): Promise<LearningProjectPlan> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    {
      role: "user",
      content: `Create a learning project from this user need:\n${description}`,
    },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0.2,
    maxTokens: 4096,
    jsonSchema: learningProjectJsonSchema(),
    meta: { label: "task_agent" },
  });
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = GeneratedLearningProject.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(`Learning project plan validation failed: ${formatZodError(validated.error)}`);
  }

  return {
    title: validated.data.title,
    goal: validated.data.goal,
    planMarkdown: validated.data.plan_markdown,
    notesMarkdown: validated.data.notes_markdown ?? "",
    suggestedLessons: validated.data.suggested_lessons.map((lesson) => ({
      name: lesson.name,
      description: lesson.description,
      prompt: lesson.prompt,
      dataScopes: [...lesson.data_scopes],
      allowedTools: ["read_learning_data"],
      writebackPolicy: "none",
    })),
    nextActions: [...validated.data.next_actions],
    raw: validated.data,
  };
}
