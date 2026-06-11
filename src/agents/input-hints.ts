import type { ChatMessage, ModelProvider } from "../providers/types";
import { extractJsonText, parseStringArrayLoose } from "./parse-llm-json";

export interface InputHintsContext {
  targetLanguage: string;
  nativeLanguage: string;
  level: string;
  recentHistory: string;
  profileSlice?: string;
  // Formatted weak-spot list (past mistakes) so the single hint can quietly give the
  // learner a chance to re-use / fix something they've gotten wrong before.
  pastMistakes?: string;
}

// One hint is small; this leaves slack for the model to reason before emitting the array.
const MAX_OUTPUT_TOKENS = 512;
// A hint is a short native cue + a near-ready opener the learner can borrow. Roomy
// enough for one natural sentence; well past it is the model writing a whole
// monologue — drop it.
const MAX_HINT_CHARS = 220;
// We surface a SINGLE most-relevant hint (no carousel rotation). The agent is asked
// for exactly one; this is a defensive cap so a stray multi-element response still
// renders as just the first.
const MAX_HINTS = 1;

export function cleanInputHintForDisplay(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("[")) cleaned = cleaned.slice(1).trim();
  if (cleaned.startsWith(",")) cleaned = cleaned.slice(1).trim();
  if (cleaned.startsWith('"')) cleaned = cleaned.slice(1).trim();
  if (cleaned.endsWith("]")) cleaned = cleaned.slice(0, -1).trim();
  cleaned = cleaned
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\\/g, "\\")
    .replace(/^[-*]\s*/, "");
  const arrow = cleaned.match(/(?:→|->)\s*(.*)$/);
  if (arrow && arrow[1].trim().length === 0) return "";
  return cleaned;
}

function parseHintCandidates(raw: string): string[] {
  const parsed = parseStringArrayLoose(raw);
  if (parsed.length > 0) return parsed;

  const text = extractJsonText(raw).trim();
  if (!text) return [];
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "string") return [value];
    if (value && typeof value === "object") {
      const hint = (value as { hint?: unknown; text?: unknown }).hint;
      const fallbackText = (value as { hint?: unknown; text?: unknown }).text;
      if (typeof hint === "string") return [hint];
      if (typeof fallbackText === "string") return [fallbackText];
    }
  } catch {
    // Some models ignore the requested JSON array and return the hint as plain text.
  }
  return [cleanInputHintForDisplay(text)];
}

export async function generateInputHints(
  provider: ModelProvider,
  ctx: InputHintsContext,
): Promise<string[]> {
  const profileBlock = ctx.profileSlice?.trim()
    ? `\nLearner profile (use their interests and what they're working on to make the hint relevant):\n${ctx.profileSlice.trim()}\n`
    : "";
  const mistakesBlock = ctx.pastMistakes?.trim()
    ? `\nThings this learner has gotten wrong before (favor a hint that quietly gives them a chance to re-use or fix ONE of these — only if it fits the conversation naturally; never force it):\n${ctx.pastMistakes.trim()}\n`
    : "";
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `You are a ${ctx.targetLanguage} conversation coach for a ${ctx.nativeLanguage} speaker at ${ctx.level} level. The learner just read the partner's latest message and may be unsure how to keep the conversation going. Give them ONE ready-to-borrow way to reply — the single most relevant, highest-value option right now — that flows naturally from what was just said, so continuing feels effortless.
${profileBlock}${mistakesBlock}
Recent conversation:
${ctx.recentHistory || "(no prior turns yet)"}

The hint has TWO parts joined by " → ":
1. A short cue IN ${ctx.nativeLanguage} naming the conversational move — the mentor's voice, e.g. the ${ctx.nativeLanguage} for "ask about the part they mentioned", "share a similar experience", or "agree and add to it".
2. A ${ctx.targetLanguage} opener the learner can almost send as-is — a natural reply that picks up on THIS conversation. Most of the sentence should already be there; use "___" only for a small personal detail they must drop in.

Example shape (cue shown in Chinese only to illustrate the format — write yours in ${ctx.nativeLanguage}, and never reuse this content):
  追问对方提到的细节 → That sounds rough — how did you end up handling ___?

Pick the ONE best hint:
- Tie the opener to something the partner actually said or to the current topic — never a generic textbook line.
- If one of the learner's past mistakes fits this moment, prefer an opener that naturally exercises that exact pattern, so replying doubles as quiet re-practice. If none fits, just give the most useful way to continue — do NOT shoehorn a mistake in.
- The opener should LOWER the effort to reply: the learner borrows it and finishes with one small detail, rather than composing from a blank page.
- Calibrate to ${ctx.level}: natural and slightly stretching, never overwhelming.

Rules:
- The cue is ALWAYS in ${ctx.nativeLanguage}; the opener is ALWAYS in ${ctx.targetLanguage}. Never translate the opener into ${ctx.nativeLanguage}.
- Do not wrap the cue or opener in quotation marks.
- Return EXACTLY ONE hint. Keep it short enough to read at a glance.

Return ONLY a valid JSON array containing that single string, nothing else.`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 0.85,
    maxTokens: MAX_OUTPUT_TOKENS,
    meta: { label: "input-hints" },
  });

  // parseStringArrayLoose tolerates a missing closing ```fence and a truncated
  // array, salvaging every complete element — so a cut-off response degrades to
  // fewer hints instead of dumping raw JSON syntax into the UI.
  return parseHintCandidates(raw)
    .map(cleanInputHintForDisplay)
    .filter((s) => s.length > 0 && s.length <= MAX_HINT_CHARS)
    .slice(0, MAX_HINTS);
}
