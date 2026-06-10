import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";

export interface TranslateContext {
  nativeLanguage: string;
  targetLanguage: string;
  experiencePreferences: string;
  selection: string; // word/phrase/sentence selected by the user
  context: string; // full sentence/paragraph containing the selection (for LLM context inference)
  customInstructions?: string; // additional instructions appended by the user in the agent library
}

// Selection translate/explain: select text in a conversation and get on-demand native-language explanation.
// If selection is a word/phrase → explain its meaning and usage in the current context; if a full sentence → give a natural translation.
function systemPrompt(ctx: TranslateContext): string {
  const base = `You help a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage}
understand a fragment they selected inside a message they are reading.

You are given the SELECTION (the exact text they highlighted) and the CONTEXT
(the surrounding sentence/paragraph it came from). Decide what they need:

- If the SELECTION is a single word or short phrase: explain what it means HERE,
  in this specific context. Give the contextual sense (not a full dictionary dump),
  its part of speech, and the base/dictionary form if the selection is inflected.
  Add one short note on nuance, register, or a fixed collocation only if it helps.
- If the SELECTION is a full sentence or longer: give a natural, faithful
  ${ctx.nativeLanguage} translation. If a structure or idiom in it is non-obvious,
  add one short line explaining it.

RULES
- Write entirely IN ${ctx.nativeLanguage}.
- Follow the learner experience preferences below when choosing translation
  style, explanation depth, terminology, and examples.
- Be concise and scannable. No preamble, no closing remarks, no code fences.
- Ground the explanation in how the selection is actually used in the CONTEXT.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

function userPrompt(ctx: TranslateContext): string {
  return `=== CONTEXT ===
${ctx.context}

=== SELECTION ===
${ctx.selection}`;
}

// Plain-text streaming. onDelta pushes to the UI as chunks arrive; returns the full text.
export async function translate(
  provider: ModelProvider,
  ctx: TranslateContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream(
    { messages, temperature: 0.2, meta: { label: "translate" } },
    onDelta,
  );
}
