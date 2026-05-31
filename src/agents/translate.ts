import type { ChatMessage, ModelProvider } from "../providers/types";

export interface TranslateContext {
  nativeLanguage: string;
  targetLanguage: string;
  selection: string; // 用户选中的词/短语/句子
  context: string; // 选中文字所在的整句/整段(给 LLM 判断语境)
}

// 划词翻译/解析:在对话里选中一段文字,按需给出母语解析。
// 选中的是词/短语 → 结合当前语境讲它的意思和用法;选中的是整句 → 给自然译文。
function systemPrompt(ctx: TranslateContext): string {
  return `You help a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage}
understand a fragment they selected inside a message they are reading.

You are given the SELECTION (the exact text they highlighted) and the CONTEXT
(the surrounding sentence/paragraph it came from). Decide what they need:

- If the SELECTION is a single word or short phrase: explain what it means HERE,
  in this specific context. Give the contextual sense (not a full dictionary dump),
  its part of speech, and the base/dictionary form if the selection is inflected.
  Add one short note on nuance, register, or a fixed collocation only if it helps.
- If the SELECTION is a full sentence or longer: give a natural, faithful
  ${ctx.nativeLanguage} translation. If a structure or idiom in it is non-obvious,
  add one short line explaining it.

RULES
- Write entirely IN ${ctx.nativeLanguage}.
- Be concise and scannable. No preamble, no closing remarks, no code fences.
- Ground the explanation in how the selection is actually used in the CONTEXT.`;
}

function userPrompt(ctx: TranslateContext): string {
  return `=== CONTEXT ===
${ctx.context}

=== SELECTION ===
${ctx.selection}`;
}

// 纯文本流式。onDelta 边收边推 UI;返回完整文本。
export async function translate(
  provider: ModelProvider,
  ctx: TranslateContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream({ messages, temperature: 0.2 }, onDelta);
}
