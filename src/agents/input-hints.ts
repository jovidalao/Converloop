import type { ChatMessage, ModelProvider } from "../providers/types";
import { parseStringArrayLoose } from "./parse-llm-json";

export interface InputHintsContext {
  targetLanguage: string;
  nativeLanguage: string;
  level: string;
  recentHistory: string;
  profileSlice?: string;
}

// Roomy enough that a full set of hints rarely truncates mid-array. Truncation is
// still handled gracefully (parseStringArrayLoose salvages complete elements), but
// a larger budget means we lose fewer hints to the cut-off.
const MAX_OUTPUT_TOKENS = 1024;
// A hint is a short native cue + a near-ready opener the learner can borrow. We
// now want openers that flow from what was just said (not bare stems), so this is
// roomy enough for one natural sentence; well past it is the model writing a whole
// monologue — drop it.
const MAX_HINT_CHARS = 140;
// Defensive upper bound only. We deliberately do NOT ask the model for a fixed
// count — it returns as many as are genuinely relevant — but we cap rendering so a
// runaway response can't flood the carousel / coach panel.
const MAX_HINTS = 12;

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
      content: `You are a ${ctx.targetLanguage} conversation coach for a ${ctx.nativeLanguage} speaker at ${ctx.level} level. The learner just read the partner's latest message and may be unsure how to keep the conversation going. Give them ready-to-borrow ways to reply that flow naturally from what was just said, so continuing feels effortless.
${profileBlock}
Recent conversation:
${ctx.recentHistory || "(no prior turns yet)"}

Each hint has TWO parts joined by " → ":
1. A short cue IN ${ctx.nativeLanguage} naming the conversational move — the mentor's voice, e.g. the ${ctx.nativeLanguage} for "ask about the part they mentioned", "share a similar experience", or "agree and add to it".
2. A ${ctx.targetLanguage} opener the learner can almost send as-is — a natural reply that picks up on THIS conversation. Most of the sentence should already be there; use "___" only for a small personal detail they must drop in.

Example shape (cue shown in Chinese only to illustrate the format — write yours in ${ctx.nativeLanguage}, and never reuse this content):
  追问对方提到的细节 → "That sounds rough — how did you end up handling ___?"
  接着分享自己的经历 → "Same here, actually. Last week I ___"

Make them about CONTINUING this specific conversation:
- Tie each opener to something the partner actually said or to the current topic — never generic textbook lines.
- Cover different moves so the learner has real choices: a follow-up question, sharing their own side, reacting/agreeing and adding to it, gently disagreeing, giving a concrete example, asking to clarify, or nudging to a related subtopic.
- Each opener should LOWER the effort to reply: the learner borrows it and finishes with one small detail, rather than composing from a blank page.
- Calibrate to ${ctx.level}: natural and slightly stretching, never overwhelming.

Rules:
- The cue is ALWAYS in ${ctx.nativeLanguage}; the opener is ALWAYS in ${ctx.targetLanguage}. Never translate the opener into ${ctx.nativeLanguage}.
- Give only as many as are genuinely useful right now — do NOT pad to hit a number, and skip anything that isn't relevant. A focused few beat a long list.
- Keep each hint short enough to read at a glance.

Return ONLY a valid JSON array of strings, nothing else.`,
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
  return parseStringArrayLoose(raw)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_HINT_CHARS)
    .slice(0, MAX_HINTS);
}
