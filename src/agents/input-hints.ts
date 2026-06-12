import type { ChatMessage, ModelProvider } from "../providers/types";
import { parseStringArrayLoose } from "./parse-llm-json";

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

// Generous cap: thinking models spend output budget on reasoning BEFORE the hint
// line appears, so a tight cap yields an empty response (same failure quickfire
// hit at 700). The hint itself is one short line; the slack costs nothing.
const MAX_OUTPUT_TOKENS = 2048;
// A hint is a short native cue + a near-ready opener the learner can borrow.
// Past this the model wrote a monologue — truncate rather than drop, so one
// verbose response still yields a usable hint instead of a blank turn.
const MAX_HINT_CHARS = 220;
// The hint is utility content: variance is the enemy. Low temperature keeps the
// cue→opener format stable and the opener anchored to the conversation.
const TEMPERATURE = 0.4;

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

// The prompt demands a single plain-text "cue → opener" line, but models drift:
// a wrapping code fence, a JSON-quoted string, a stray array, preamble lines.
// Pick the most hint-shaped line out of whatever came back.
function extractHintLine(raw: string): string {
  let text = raw.trim();
  // Strip a wrapping code fence even when truncation dropped the closing one.
  if (text.startsWith("```")) {
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);
    const close = text.lastIndexOf("```");
    if (close >= 0) text = text.slice(0, close);
    text = text.trim();
  }
  // A whole-response JSON string ("cue → opener") decodes cleanly.
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      const decoded = JSON.parse(text) as unknown;
      if (typeof decoded === "string") text = decoded.trim();
    } catch {
      // Not a JSON string — keep as-is and fall through to line picking.
    }
  }
  // A stray JSON array of hints: take the first element.
  const fromArray = parseStringArrayLoose(text);
  if (fromArray.length > 0) return fromArray[0];
  const lines = text
    .split("\n")
    .map(cleanInputHintForDisplay)
    .filter((line) => line.length > 0);
  // Prefer the line with the cue→opener arrow; otherwise the first non-empty line.
  return lines.find((line) => /→|->/.test(line)) ?? lines[0] ?? "";
}

function truncateHint(hint: string): string {
  if (hint.length <= MAX_HINT_CHARS) return hint;
  return `${hint.slice(0, MAX_HINT_CHARS - 1).trimEnd()}…`;
}

function buildMessages(ctx: InputHintsContext): ChatMessage[] {
  const profileBlock = ctx.profileSlice?.trim()
    ? `\nLearner profile (use their interests and what they're working on to make the hint relevant):\n${ctx.profileSlice.trim()}\n`
    : "";
  const mistakesBlock = ctx.pastMistakes?.trim()
    ? `\nThings this learner has gotten wrong before (favor a hint that quietly gives them a chance to re-use or fix ONE of these — only if it fits the conversation naturally; never force it):\n${ctx.pastMistakes.trim()}\n`
    : "";
  return [
    {
      role: "user",
      content: `You are a ${ctx.targetLanguage} conversation coach for a ${ctx.nativeLanguage} speaker at ${ctx.level} level. The learner just read the partner's latest message and may be unsure how to keep the conversation going. Give them ONE ready-to-borrow way to reply — the single most relevant, highest-value option right now — that flows naturally from what was just said, so continuing feels effortless.
${profileBlock}${mistakesBlock}
Recent conversation:
${ctx.recentHistory || "(no prior turns yet)"}

The hint is ONE line with TWO parts joined by " → ":
1. A short cue IN ${ctx.nativeLanguage} (a few words) naming the conversational move — the mentor's voice, e.g. the ${ctx.nativeLanguage} for "ask about the part they mentioned", "share a similar experience", or "agree and add to it".
2. A ${ctx.targetLanguage} opener the learner can almost send as-is — a natural reply that picks up on THIS conversation. Most of the sentence should already be there; use "___" only for a small personal detail they must drop in (at most one blank).

Example shape (cue shown in Chinese only to illustrate the format — write yours in ${ctx.nativeLanguage}, and never reuse this content):
追问对方提到的细节 → That sounds rough — how did you end up handling ___?

Pick the ONE best hint:
- If the partner's latest message ends with a question, the opener MUST help answer that exact question.
- Tie the opener to something concrete the partner actually said (a detail, a word, an event) — never a generic textbook line.
- If one of the learner's past mistakes fits this moment, prefer an opener that naturally exercises that exact pattern, so replying doubles as quiet re-practice. If none fits, just give the most useful way to continue — do NOT shoehorn a mistake in.
- The opener should LOWER the effort to reply: the learner borrows it and finishes with one small detail, rather than composing from a blank page.
- Calibrate to ${ctx.level}: natural and slightly stretching, never overwhelming.

Rules:
- The cue is ALWAYS in ${ctx.nativeLanguage}; the opener is ALWAYS in ${ctx.targetLanguage}. Never translate the opener into ${ctx.nativeLanguage}.
- Do not wrap the cue or opener in quotation marks.
- Keep the whole line under 200 characters.
- Reply with ONLY that single hint line — no JSON, no markdown, no numbering, no explanation, nothing before or after it.`,
    },
  ];
}

export async function generateInputHints(
  provider: ModelProvider,
  ctx: InputHintsContext,
): Promise<string[]> {
  const messages = buildMessages(ctx);
  const attempt = async (): Promise<string> => {
    const raw = await provider.generate({
      messages,
      temperature: TEMPERATURE,
      maxTokens: MAX_OUTPUT_TOKENS,
      meta: { label: "input-hints" },
    });
    return cleanInputHintForDisplay(extractHintLine(raw));
  };

  // One retry on an empty/unusable response (thinking budget exhausted, format
  // miss, transient provider error) — a single hiccup should not leave the whole
  // turn hintless. A second failure propagates so the caller can degrade.
  let hint = "";
  try {
    hint = await attempt();
  } catch {
    // Swallow the first error; the retry below either succeeds or throws.
  }
  if (!hint) hint = await attempt();
  hint = truncateHint(hint);
  return hint ? [hint] : [];
}
