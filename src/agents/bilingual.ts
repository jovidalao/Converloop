import type { ChatMessage, ModelProvider } from "../providers/types";

export interface BilingualContext {
  nativeLanguage: string;
  targetLanguage: string;
  experiencePreferences: string;
  reply: string; // 要做双语对照的对话回复
}

// 双语阅读:把一条回复重排成 Markdown——原文逐句保留(含其自带格式),
// 每句后内联母语译文,译文用 *单星号* 标记,渲染时把 em 覆盖成译文样式。
function systemPrompt(ctx: BilingualContext): string {
  return `You produce an interlinear bilingual reading view of a ${ctx.targetLanguage}
message for a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage}.

Reproduce the message in Markdown, KEEPING its original formatting and paragraph layout
(bold, lists, line breaks, etc.). After EACH ${ctx.targetLanguage} sentence, insert that
sentence's ${ctx.nativeLanguage} translation right after it, wrapped in single asterisks
(Markdown emphasis):

Original sentence one. *母语翻译一* Original sentence two. *母语翻译二*

RULES
- Keep the ${ctx.targetLanguage} text EXACTLY as written — verbatim, do not edit or rephrase.
- Translate naturally into ${ctx.nativeLanguage}, faithful to meaning and tone.
- Follow the learner experience preferences below for translation style and
  reading support, unless they conflict with preserving the original text.
- Wrap ONLY the translations in *single asterisks*. Never wrap the original text.
- Do NOT use single-asterisk emphasis for anything other than the translations.
- Preserve the original paragraph breaks and any list/structure.
- No preamble, no numbering, no commentary, no code fences — just the interlinear message.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}`;
}

function userPrompt(ctx: BilingualContext): string {
  return `=== MESSAGE ===
${ctx.reply}`;
}

// 去掉模型偶尔套上的 ``` 代码围栏。
function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1].trim() : t;
}

const MAX_OUTPUT_TOKENS = 4096;

// 一次性返回完整的双语 Markdown(不流式)。渲染交给 Markdown 组件 + em 覆盖。
export async function bilingual(
  provider: ModelProvider,
  ctx: BilingualContext,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0.2,
    maxTokens: MAX_OUTPUT_TOKENS,
  });

  const md = stripFences(raw);
  if (!md.trim()) throw new Error("双语对照生成失败,请重试");
  return md;
}
