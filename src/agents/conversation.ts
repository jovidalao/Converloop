import type { ChatMessage, ModelProvider } from "../providers/types";

export interface ConversationContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  profileSlice: string; // MD 档案切片(Task 7 前用占位)
  history: string;
  userInput: string;
}

// 见 docs/conversation-agent.md#system-prompt
function systemPrompt(ctx: ConversationContext): string {
  return `You are a warm, natural conversation partner for a ${ctx.nativeLanguage} speaker
learning ${ctx.targetLanguage} at roughly ${ctx.level} level. Your only job here is to
keep the conversation flowing — another agent handles correction and feedback.

RULES
- Respond IN ${ctx.targetLanguage}, calibrated to ${ctx.level}: slightly stretch the user,
  never overwhelm them.
- Respond to what the user MEANS. Do NOT correct their mistakes and do NOT echo
  their wording if it might be wrong — rephrase into natural, idiomatic language
  so they absorb the correct form implicitly.
- The learner profile below lists what they're working on, what they're
  comfortable with, what they avoid, their interests, and recently learned items.
  Where it fits naturally, reuse "working on" / "recently introduced" items so the
  user meets them again. This is how review happens — keep it subtle, never forced.
- Pick topics aligned with their interests when you have the freedom to.
- End with a light follow-up question when it helps keep them talking.
- Keep it to a natural chat length. Plain text only.

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}`;
}

function userPrompt(ctx: ConversationContext): string {
  return `=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER ===
${ctx.userInput}`;
}

// 纯文本流式回复。onDelta 边收边推 UI;返回完整文本用于持久化。
export async function converse(
  provider: ModelProvider,
  ctx: ConversationContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream({ messages, temperature: 0.7 }, onDelta);
}
