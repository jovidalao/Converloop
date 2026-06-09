import { z } from "zod";
import {
  GAP_KEY_ITEM_TYPE_VALUES,
  MASTERY_TYPE_VALUES,
  MASTERY_UPDATE_SIGNAL_VALUES,
} from "../db/mastery-values";
import { toJsonSchema } from "./json-schema";

// See docs/tutor-agent.md#output-schemazod. LLM only observes, code does bookkeeping; this only validates observations.
export const IssueCategory = z.enum([
  "grammar",
  "word_choice",
  "collocation",
  "spelling",
  "punctuation",
  "register",
  "naturalness",
]);

// expression_gap = a situation/intent the learner "wanted to express but couldn't say" (native language / mixed input).
export const MasteryType = z.enum(MASTERY_TYPE_VALUES);
const GapKeyItemType = z.enum(GAP_KEY_ITEM_TYPE_VALUES);

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
  signal: z.enum(MASTERY_UPDATE_SIGNAL_VALUES),
  evidence: z.string().optional(),
});
export type MasteryUpdate = z.infer<typeof MasteryUpdate>;

// "Expression gap" produced by native-language/mixed input: no target-language original to diff against,
// so we explain the sentence-building approach instead.
// See docs/expression-gap.md.
export const GapKeyItem = z.object({
  text: z.string(), // target-language word / collocation / sentence pattern
  gloss: z.string(), // native-language gloss
  mastery_key: z.string(),
  mastery_label: z.string(),
  mastery_type: GapKeyItemType, // vocab | collocation | grammar
});
export type GapKeyItem = z.infer<typeof GapKeyItem>;

export const ExpressionGap = z.object({
  mastery_key: z.string(), // stable key for this situation/intent, e.g. "gap:decline_request_politely"
  mastery_label: z.string(), // human-readable label: e.g. "politely declining a request"
  original: z.string(), // user's original sentence (native/mixed) — the most important practice record
  target_expression: z.string(), // idiomatic full target-language sentence
  template: z.string().optional(), // reusable sentence template, e.g. "I'd rather not ___, but ___"
  explanation: z.string(), // explanation: the thinking behind how to build this sentence (in native language)
  key_items: z.array(GapKeyItem), // key words / sentence patterns used
  usage_note: z.string().optional(), // when and how to reuse it (in native language)
});
export type ExpressionGap = z.infer<typeof ExpressionGap>;

// Core correction shape, without expression_gap. Used as the provider schema for the common case —
// pure target-language input, where a gap can never apply — so the hot path stays shallow. Deeply
// nested schemas are what make models double-encode/truncate nested fields; keeping this flat raises
// first-pass structured-output success.
export const TutorAnalysisCore = z.object({
  is_correct: z.boolean(),
  corrected: z.string(),
  natural: z.string(),
  issues: z.array(Issue),
  mastery_updates: z.array(MasteryUpdate),
});

export const TutorAnalysis = TutorAnalysisCore.extend({
  // Must be null for pure target-language input; filled when native or mixed input (mixed can coexist with issues).
  expression_gap: ExpressionGap.nullable(),
});
export type TutorAnalysis = z.infer<typeof TutorAnalysis>;

// JSON schema for provider structured output: inline refs, strip $schema, so OpenAI-compatible
// endpoints can consume it directly. includeGap=false sends the shallow core schema for turns that
// cannot have an expression gap; parsing still validates against the full TutorAnalysis (a missing
// expression_gap normalizes to null), so the response side is unaffected.
export function tutorJsonSchema(includeGap = true): {
  name: string;
  schema: Record<string, unknown>;
} {
  return toJsonSchema(
    "TutorAnalysis",
    includeGap ? TutorAnalysis : TutorAnalysisCore,
  );
}
