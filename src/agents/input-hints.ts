import type { ChatMessage, ModelProvider } from "../providers/types";
import { extractJsonText } from "./parse-llm-json";

export interface InputHintsContext {
  targetLanguage: string;
  nativeLanguage: string;
  level: string;
  recentHistory: string;
  profileSlice?: string;
}

const MAX_OUTPUT_TOKENS = 512;
// A hint is a short coaching cue + a phrase to try, never a full reply. The native
// cue makes it a little longer than a bare scaffold, but anything past this is
// almost certainly the model writing the answer — drop it.
const MAX_HINT_CHARS = 110;

export async function generateInputHints(
  provider: ModelProvider,
  ctx: InputHintsContext,
): Promise<string[]> {
  const profileBlock = ctx.profileSlice?.trim()
    ? `\nLearner profile (use their interests and what they're working on to make hints relevant):\n${ctx.profileSlice.trim()}\n`
    : "";
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `You are a ${ctx.targetLanguage} tutor coaching a ${ctx.nativeLanguage} speaker at ${ctx.level} level. Based on the conversation so far, give short COACHING HINTS that nudge the learner on HOW to phrase their own next reply — the way a mentor leans in and says "here's a way you could put it."
${profileBlock}
Recent conversation:
${ctx.recentHistory || "(no prior turns yet)"}

Produce 6–8 hints. Each hint has TWO parts joined by " → ":
1. A short cue IN ${ctx.nativeLanguage} naming the communicative intent or situation — this is the mentor's coaching voice, e.g. the ${ctx.nativeLanguage} for "to disagree politely" or "to give a concrete example".
2. A ${ctx.targetLanguage} expression to TRY for that intent — an opener or sentence frame the learner can borrow and finish themselves. Use "___" for the part they must complete when it helps.

Example shape (cue shown in Chinese here only to illustrate the format — write yours in ${ctx.nativeLanguage}, and never reuse this content):
  想委婉反驳 → "I see your point, but ___"
  让观点更有力 → "I'd argue that ___"

Rules:
- The cue is ALWAYS in ${ctx.nativeLanguage}; the expression is ALWAYS in ${ctx.targetLanguage}. Never translate the expression into ${ctx.nativeLanguage}.
- The expression is a STARTER, not a complete ready-to-send reply. The learner still does the real composing.
- Be specific to THIS conversation and learner, not generic filler.
- Vary the intents across the list (agreeing, pushing back, asking, giving an example, hedging, clarifying, …); do not repeat an intent.
- Keep each hint short enough to read at a glance.

Return ONLY a valid JSON array of 6–8 strings, nothing else.`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 0.85,
    maxTokens: MAX_OUTPUT_TOKENS,
    meta: { label: "input-hints" },
  });

  const clean = (list: string[]) =>
    list
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= MAX_HINT_CHARS)
      .slice(0, 10);

  try {
    const parsed = JSON.parse(extractJsonText(raw));
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((s) => typeof s === "string")
    ) {
      return clean(parsed as string[]);
    }
  } catch {
    // Fallback: split plain-text lines if the model didn't return JSON.
    const lines = clean(
      raw.split("\n").map((l) => l.replace(/^[-•*\d.]+\s*/, "")),
    );
    if (lines.length >= 3) return lines;
  }
  return [];
}
