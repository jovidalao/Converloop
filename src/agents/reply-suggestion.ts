import type {
  ChatMessage,
  FinishReason,
  ModelProvider,
} from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";

export type ReplySuggestionSource = "user_message" | "partner_reply";

export interface ReplySuggestionContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  experiencePreferences: string;
  profileSlice: string;
  history: string;
  source: ReplySuggestionSource;
  userMessage?: string;
  partnerReply?: string;
  customInstructions?: string; // additional instructions appended by the user in the agent library
}

export interface ReplySuggestionResult {
  text: string;
  finishReason: FinishReason | null;
}

function systemPrompt(ctx: ReplySuggestionContext): string {
  const task =
    ctx.source === "user_message"
      ? `The learner clicked a recommendation button under a message they already sent.
Infer what they meant, then rewrite that message as ONE natural, idiomatic reply they
could have sent in ${ctx.targetLanguage}.`
      : `The learner clicked a recommendation button under the partner's latest reply.
Suggest ONE natural, idiomatic next reply the learner could send in ${ctx.targetLanguage}.`;

  const base = `You help a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage}
at roughly ${ctx.level} level write a good chat reply.

${task}

RULES
- Output only the suggested reply text, IN ${ctx.targetLanguage}.
- Keep the learner's intended meaning and the conversation context.
- Sound like a real person in this conversation, not a textbook example.
- Calibrate to ${ctx.level}: natural and slightly stretching, but not too difficult.
- Follow the learner experience preferences below for tone, spelling, variety, and style.
- Do not explain, label, translate, quote the original, or provide multiple options.
- Do not answer as the conversation partner; write what the learner could send.
- Keep it concise: usually 1-3 complete sentences. Do not trail off or stop mid-sentence.
- Light Markdown is allowed only if it would be natural in the chat.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

function userPrompt(ctx: ReplySuggestionContext): string {
  const sourceBlock =
    ctx.source === "user_message"
      ? `=== LEARNER MESSAGE TO REWRITE ===
${ctx.userMessage ?? ""}`
      : `=== PARTNER REPLY TO RESPOND TO ===
${ctx.partnerReply ?? ""}`;

  return `=== RECENT CONVERSATION BEFORE/AT THIS POINT ===
${ctx.history || "(none)"}

${sourceBlock}`;
}

const MAX_OUTPUT_TOKENS = 1024;

export async function suggestReplyText(
  provider: ModelProvider,
  ctx: ReplySuggestionContext,
  onDelta: (delta: string) => void,
): Promise<ReplySuggestionResult> {
  let finish: FinishReason | null = null;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  const reply = await provider.stream(
    {
      messages,
      temperature: 0.55,
      maxTokens: MAX_OUTPUT_TOKENS,
      onFinish: (reason) => {
        finish = reason;
      },
    },
    onDelta,
  );
  const text = reply.trim();
  if (!text)
    throw new Error("Reply suggestion generation failed, please retry");
  return { text, finishReason: finish };
}
