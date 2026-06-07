import { z } from "zod";
import type { MasteryStatus } from "../db/mastery-logic";
import {
  TARGET_LANGUAGE_MASTERY_TYPE_VALUES,
  type TargetLanguageMasteryType,
} from "../db/mastery-values";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { toJsonSchema } from "./json-schema";
import { formatZodError, parseLLMJson } from "./parse-llm-json";

const SelectionLearningItem = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(TARGET_LANGUAGE_MASTERY_TYPE_VALUES),
  notes: z.string().nullable().optional(),
});

export interface SelectionLearningItemDraft {
  key: string;
  label: string;
  type: TargetLanguageMasteryType;
  status: MasteryStatus;
  example: string;
  notes: string | null;
}

function textKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_:-]/gu, "")
    .slice(0, 80);
}

function fallbackType(selection: string): TargetLanguageMasteryType {
  const words = selection.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return "vocab";
  if (words.length <= 6) return "collocation";
  return "grammar";
}

export function fallbackSelectionLearningItem(
  selection: string,
  context: string,
): SelectionLearningItemDraft {
  const label = selection.trim();
  const type = fallbackType(label);
  const keyBase = textKey(label) || crypto.randomUUID();
  return {
    key: `${type}:${keyBase}`,
    label,
    type,
    status: "learning",
    example: context,
    notes: label,
  };
}

function systemPrompt(ctx: {
  nativeLanguage: string;
  targetLanguage: string;
}): string {
  return `You create one learning-data item from highlighted text in a language-learning chat.

The learner is a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage}.
Classify the selected ${ctx.targetLanguage} text as:
- vocab: a single word or lexical item
- collocation: a reusable phrase, phrasal verb, chunk, idiom, or fixed expression
- grammar: a reusable sentence pattern or structure
- error_pattern: only if the selected text is explicitly an error pattern

Rules:
- Return JSON only.
- key must be stable lowercase snake_case with a type prefix, e.g.
  vocab:deadline, collocation:push_back_a_deadline, grammar:would_rather_not_but.
- label should be human-readable.
- notes should briefly explain meaning/usage in ${ctx.nativeLanguage}, not a long dictionary entry.
- Do not create expression_gap from highlighted target-language text.`;
}

export async function generateSelectionLearningItem(
  provider: ModelProvider,
  input: {
    nativeLanguage: string;
    targetLanguage: string;
    selection: string;
    context: string;
  },
): Promise<SelectionLearningItemDraft> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input) },
    {
      role: "user",
      content: `=== CONTEXT ===
${input.context}

=== SELECTION ===
${input.selection}`,
    },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0,
    maxTokens: 800,
    jsonSchema: toJsonSchema("SelectionLearningItem", SelectionLearningItem),
    meta: { label: "selection_learning_item" },
  });
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = SelectionLearningItem.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(
      `Word lookup item validation failed: ${formatZodError(validated.error)}`,
    );
  }
  const data = validated.data;
  return {
    key: data.key,
    label: data.label,
    type: data.type,
    status: "learning",
    example: input.context,
    notes: data.notes?.trim() || null,
  };
}
