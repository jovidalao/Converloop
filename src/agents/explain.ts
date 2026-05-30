import type { ChatMessage, ModelProvider } from "../providers/types";

export interface ExplainContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  profileSlice: string; // MD 档案切片(定性掌握情况),和对话 agent 同源
  reply: string; // 要讲解的对话回复
}

// 按需讲解:不在热路径,读 MD 档案判断"这个学习者大概哪里看不懂"。
function systemPrompt(ctx: ExplainContext): string {
  return `You are a patient tutor helping a ${ctx.nativeLanguage} speaker learning
${ctx.targetLanguage} at roughly ${ctx.level} level understand a message they just
received from their conversation partner.

Your job: explain the partner's ${ctx.targetLanguage} message so THIS specific learner
can fully understand it. Use the learner profile to judge what they already know versus
what they likely don't — explain only what's likely to be unclear to them.

RULES
- Write the explanation IN ${ctx.nativeLanguage} (the learner's native language).
- Pick out the words, phrases, idioms, collocations, and grammar in the message that a
  ${ctx.level} learner — and especially THIS learner, per the profile — probably won't
  fully grasp. Skip what they clearly already know; do not explain the obvious.
- For each item: quote the ${ctx.targetLanguage} fragment, then give its meaning, any
  nuance, and (for grammar) briefly how it's formed. Be concrete.
- If the whole message is already easy for this learner, just say so in one line.
- Be concise and scannable. No preamble, no closing remarks.

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}`;
}

function userPrompt(ctx: ExplainContext): string {
  return `=== PARTNER MESSAGE TO EXPLAIN ===
${ctx.reply}`;
}

// 纯文本流式讲解。onDelta 边收边推 UI;返回完整文本。
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
