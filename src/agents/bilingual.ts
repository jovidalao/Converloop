import type { ChatMessage, ModelProvider } from "../providers/types";

export interface BilingualContext {
  nativeLanguage: string;
  targetLanguage: string;
  reply: string; // 要做双语对照的对话回复
}

// 双语阅读:把一条对话回复逐句拆开,目标语言原句 + 母语翻译对照。
// 不读档案、不批改——纯翻译,便宜,不持久化。
function systemPrompt(ctx: BilingualContext): string {
  return `You turn a ${ctx.targetLanguage} message into an interlinear bilingual reading
view for a ${ctx.nativeLanguage} speaker who is learning ${ctx.targetLanguage}.

Reproduce the message in Markdown, KEEPING its original paragraph and line layout. After
EACH ${ctx.targetLanguage} sentence, insert that sentence's ${ctx.nativeLanguage} translation
inline, right after it, wrapped in single asterisks (Markdown emphasis):

Original sentence one. *母语翻译一* Original sentence two. *母语翻译二*

RULES
- Keep the ${ctx.targetLanguage} text EXACTLY as written — do not edit, fix, or rephrase it.
- Translate naturally into ${ctx.nativeLanguage}, faithful to meaning and tone, not word-for-word.
- Wrap ONLY the translations in *single asterisks*. Never wrap the original text.
- Preserve the original paragraph breaks (blank lines) and any list structure.
- No preamble, no numbering, no extra commentary — just the interlinear message.`;
}

function userPrompt(ctx: BilingualContext): string {
  return `=== MESSAGE ===
${ctx.reply}`;
}

// 流式输出双语对照 Markdown。onDelta 边收边推 UI;返回完整文本。
export async function bilingual(
  provider: ModelProvider,
  ctx: BilingualContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream({ messages, temperature: 0.2 }, onDelta);
}
