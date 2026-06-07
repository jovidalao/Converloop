import type { ChatMessage, ModelProvider } from "../providers/types";
import { extractJsonText } from "./parse-llm-json";

export interface InputHintsContext {
  targetLanguage: string;
  nativeLanguage: string;
  level: string;
  recentHistory: string;
}

const MAX_OUTPUT_TOKENS = 512;

export async function generateInputHints(
  provider: ModelProvider,
  ctx: InputHintsContext,
): Promise<string[]> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `You help a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at ${ctx.level} level come up with ideas for their next message.

Recent conversation:
${ctx.recentHistory || "(no prior turns yet)"}

Generate exactly 8 short reply hints for the learner's NEXT message. Mix the following types:
- A sentence starter in ${ctx.targetLanguage} they could use (e.g. "I completely agree, but…" / "Actually, I think…")
- A vocabulary or expression tip (e.g. "Try using 'nevertheless' here" / "Practice '~にとって'")
- A conversational direction (e.g. "Ask about their experience with…" / "Share a personal anecdote")

Rules:
- Each hint is 15–60 characters max
- At least 4 hints should be ${ctx.targetLanguage} sentence starters or phrases
- Vary types — no two hints have the same shape
- Be specific to the conversation context, not generic filler
- Do NOT include numbers, bullets, or labels — just the hint text

Return ONLY a valid JSON array of 8 strings, nothing else.`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 0.85,
    maxTokens: MAX_OUTPUT_TOKENS,
    meta: { label: "input-hints" },
  });

  try {
    const parsed = JSON.parse(extractJsonText(raw));
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((s) => typeof s === "string")
    ) {
      return (parsed as string[]).filter((s) => s.trim().length > 0).slice(0, 10);
    }
  } catch {
    // Fallback: split plain-text lines if model didn't return JSON
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
      .filter((l) => l.length > 0);
    if (lines.length >= 3) return lines.slice(0, 10);
  }
  return [];
}
