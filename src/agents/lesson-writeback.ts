import { z } from "zod";
import type { MasteryType } from "../db/mastery-logic";
import type { MasteryItem } from "../db/schema";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { toJsonSchema } from "./json-schema";
import { formatZodError, parseLLMJson } from "./parse-llm-json";

const LessonWritebackSignal = z.object({
  key: z.string().min(1),
  evidence: z.string().optional(),
});

const LessonWritebackResult = z.object({
  summary: z.string(),
  signals: z.array(LessonWritebackSignal).max(3),
});

export type LessonWritebackResult = z.infer<typeof LessonWritebackResult>;

export interface LessonWritebackCandidate {
  key: string;
  label: string;
  type: MasteryType;
  status: string;
  example?: string | null;
  notes?: string | null;
}

function oneLine(text: string | null | undefined, max = 160): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export function toLessonWritebackCandidate(
  item: MasteryItem,
): LessonWritebackCandidate {
  return {
    key: item.key,
    label: item.label,
    type: item.type,
    status: item.status,
    example: item.example,
    notes: item.notes,
  };
}

function formatCandidates(candidates: LessonWritebackCandidate[]): string {
  if (candidates.length === 0) return "(none)";
  return candidates
    .map((item) => {
      const details = [
        item.example ? `example="${oneLine(item.example)}"` : null,
        item.notes ? `note="${oneLine(item.notes)}"` : null,
      ].filter(Boolean);
      return `- [${item.type}/${item.status}] ${item.label} (${item.key})${
        details.length ? ` — ${details.join("; ")}` : ""
      }`;
    })
    .join("\n");
}

function systemPrompt(ctx: {
  nativeLanguage: string;
  targetLanguage: string;
}): string {
  return `You are a lesson writeback observer for a language-learning app.

The learner clicked a button saying their latest lesson answer should count as
mastery evidence. Your job is to inspect the latest lesson turn and choose which
EXISTING candidate mastery items, if any, the learner clearly demonstrated.

Rules:
- Return JSON only.
- Emit only "correct" evidence by listing candidate keys in signals.
- Use ONLY keys from the candidate list. Do not create new keys.
- Be conservative: if the learner was asking a question, answering in their
  native language, copying the teacher, or only partially attempting the item,
  return signals=[].
- For expression_gap items, emit a signal only when the learner produced a
  target-language expression matching the gap's situation/target expression.
- Keep summary short and write it in ${ctx.nativeLanguage}.`;
}

export async function analyzeLessonWriteback(
  provider: ModelProvider,
  input: {
    nativeLanguage: string;
    targetLanguage: string;
    level: string;
    lessonName: string;
    candidates: LessonWritebackCandidate[];
    history: string;
    userInput: string;
    partnerReply: string;
  },
): Promise<LessonWritebackResult> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt(input),
    },
    {
      role: "user",
      content: `=== LESSON ===
${input.lessonName}

=== LANGUAGES ===
Native: ${input.nativeLanguage}
Target: ${input.targetLanguage}
Level: ${input.level}

=== CANDIDATE MASTERY ITEMS ===
${formatCandidates(input.candidates)}

=== RECENT LESSON CONVERSATION ===
${input.history || "(none)"}

=== LATEST LEARNER ANSWER ===
${input.userInput}

=== TEACHER REPLY AFTER THAT ANSWER ===
${input.partnerReply || "(none yet)"}`,
    },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0,
    maxTokens: 1200,
    jsonSchema: toJsonSchema("LessonWritebackResult", LessonWritebackResult),
    meta: { label: "lesson_writeback" },
  });
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = LessonWritebackResult.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(`Lesson writeback validation failed: ${formatZodError(validated.error)}`);
  }
  return validated.data;
}
