import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";

export interface ExplainContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  experiencePreferences: string;
  profileSlice: string; // MD profile slice (qualitative mastery status), same source as the conversation agent
  reply: string; // the conversation reply to explain
  customInstructions?: string; // additional instructions appended by the user in the agent library
}

// On-demand explanation: not on the hot path; reads the MD profile to determine "where this learner is likely to get confused".
function systemPrompt(ctx: ExplainContext): string {
  const base = `You are a patient tutor helping a ${ctx.nativeLanguage} speaker learning
${ctx.targetLanguage} at roughly ${ctx.level} level understand a message they just
received from their conversation partner.

Your job: explain the partner's ${ctx.targetLanguage} message so THIS specific learner
can fully understand it. Use the learner profile to judge what they already know versus
what they likely don't — explain only what's likely to be unclear to them.

RULES
- Write the explanation IN ${ctx.nativeLanguage} (the learner's native language).
- Follow the learner experience preferences below when deciding explanation
  depth, wording, examples, and translation style.
- Focus on what BLOCKS comprehension for a non-native reader: grammar structures,
  idioms, phrasal verbs, collocations, and idiomatic/colloquial usage — the things
  whose meaning a word-by-word reading won't reveal. Prioritize THIS learner's likely
  blind spots per the profile; skip what they clearly already know.
- Do NOT gloss individual vocabulary words — the learner can look those up. Mention a
  single word only when its meaning HERE is non-obvious (idiomatic sense, false friend,
  unexpected register), and then explain that twist, not the dictionary definition.
- For each item: quote the ${ctx.targetLanguage} fragment, then explain how it works —
  the structure/pattern (briefly how it's formed) or the idiomatic meaning and nuance.
  Be concrete.
- If nothing in the message would trip up this learner, just say so in one line.
- Be concise and scannable. No preamble, no closing remarks.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

function userPrompt(ctx: ExplainContext): string {
  return `=== PARTNER MESSAGE TO EXPLAIN ===
${ctx.reply}`;
}

// Plain-text streaming explanation. onDelta pushes to the UI as chunks arrive; returns the full text.
export async function explain(
  provider: ModelProvider,
  ctx: ExplainContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream({ messages, temperature: 0.3 }, onDelta);
}
