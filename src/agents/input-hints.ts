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
// A hint is a short scaffold, never a full reply. Anything much longer than a
// phrase is almost certainly the model writing the answer — drop it.
const MAX_HINT_CHARS = 80;

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
      content: `You are a ${ctx.targetLanguage} tutor helping a ${ctx.nativeLanguage} speaker at ${ctx.level} level. Based on the conversation so far, give the learner short HINTS that help them write THEIR OWN next reply.
${profileBlock}
Recent conversation:
${ctx.recentHistory || "(no prior turns yet)"}

Produce 6–8 hints. Each hint must:
- Be written IN ${ctx.targetLanguage} (the language being learned), so reading it is itself practice.
- Point toward an idea WITHOUT writing the reply for them. Use a varied mix of:
  • a reusable sentence FRAME with a blank "___" for the learner to complete (a pattern, e.g. the ${ctx.targetLanguage} equivalent of "I'd rather ___ than ___")
  • a useful WORD or short expression they could weave in — add a brief ${ctx.nativeLanguage} gloss in parentheses ONLY if it is likely above ${ctx.level} level
  • a DIRECTION: something they could say, ask about, react to, or give an example of next
- NEVER be a complete, ready-to-send sentence. You give the scaffold; the learner still does the real thinking and composing.
- Be short — roughly 4–10 words — and specific to THIS conversation and learner, not generic filler.
- Differ from one another in shape; do not repeat the same structure twice.

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
