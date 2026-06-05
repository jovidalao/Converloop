import { z } from "zod";
import { toJsonSchema } from "./json-schema";

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
  "expression_gap", // 一个"想表达但说不出"的情景/意图(母语/混说输入)
]);
const GapKeyItemType = z.enum(["vocab", "grammar", "collocation"]);

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

// 母语/混说输入产生的"表达缺口":没有目标语原句可 diff,改为讲解构句思路。
// 见 docs/expression-gap.md。
export const GapKeyItem = z.object({
  text: z.string(), // 目标语的词 / 搭配 / 句式
  gloss: z.string(), // 母语释义
  mastery_key: z.string(),
  mastery_label: z.string(),
  mastery_type: GapKeyItemType, // vocab | collocation | grammar
});
export type GapKeyItem = z.infer<typeof GapKeyItem>;

export const ExpressionGap = z.object({
  mastery_key: z.string(), // 这个情景/意图的稳定键,如 "gap:decline_request_politely"
  mastery_label: z.string(), // 人类可读:"委婉拒绝请求"
  original: z.string(), // 用户原句(母语/混说)—— 最重要的练习记录
  target_expression: z.string(), // 地道的目标语整句
  template: z.string().optional(), // 可复用句式模板,如 "I'd rather not ___, but ___"
  explanation: z.string(), // 讲解:怎么构成这句话的思路(母语)
  key_items: z.array(GapKeyItem), // 用到的关键词 / 句式
  usage_note: z.string().optional(), // 什么场景、怎么套用(母语)
});
export type ExpressionGap = z.infer<typeof ExpressionGap>;

export const TutorAnalysis = z.object({
  is_correct: z.boolean(),
  corrected: z.string(),
  natural: z.string(),
  issues: z.array(Issue),
  mastery_updates: z.array(MasteryUpdate),
  // 纯目标语输入时必须为 null;母语或混说时填充(混说时可与 issues 共存)。
  expression_gap: ExpressionGap.nullable(),
});
export type TutorAnalysis = z.infer<typeof TutorAnalysis>;

// 喂给 provider 结构化输出的 JSON schema。inline refs、去掉 $schema,
// 让 OpenAI 兼容端点能直接吃。
export function tutorJsonSchema(): {
  name: string;
  schema: Record<string, unknown>;
} {
  return toJsonSchema("TutorAnalysis", TutorAnalysis);
}
