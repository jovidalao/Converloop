import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// 见 docs/tutor-agent.md#输出-schemazod。LLM 只观察,代码记账;这里只校验观察结果。
export const IssueCategory = z.enum([
  "grammar",
  "word_choice",
  "collocation",
  "spelling",
  "punctuation",
  "register",
  "naturalness",
]);

export const MasteryType = z.enum([
  "vocab",
  "grammar",
  "collocation",
  "error_pattern",
]);

export const Issue = z.object({
  category: IssueCategory,
  span_original: z.string(),
  span_corrected: z.string(),
  explanation: z.string(),
  severity: z.enum(["minor", "moderate", "major"]),
  mastery_key: z.string(),
  mastery_label: z.string(),
  mastery_type: MasteryType,
});
export type Issue = z.infer<typeof Issue>;

export const MasteryUpdate = z.object({
  key: z.string(),
  label: z.string(),
  type: MasteryType,
  signal: z.enum(["correct", "introduced"]),
  evidence: z.string().optional(),
});
export type MasteryUpdate = z.infer<typeof MasteryUpdate>;

export const TutorAnalysis = z.object({
  is_correct: z.boolean(),
  corrected: z.string(),
  natural: z.string(),
  issues: z.array(Issue),
  mastery_updates: z.array(MasteryUpdate),
});
export type TutorAnalysis = z.infer<typeof TutorAnalysis>;

// 喂给 provider 结构化输出的 JSON schema。inline refs、去掉 $schema,
// 让 OpenAI 兼容端点能直接吃。
export function tutorJsonSchema(): { name: string; schema: Record<string, unknown> } {
  const schema = zodToJsonSchema(TutorAnalysis, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: "TutorAnalysis", schema };
}
