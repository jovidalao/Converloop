import type { ChatMessage, ModelProvider } from "../providers/types";

// 会话滚动摘要 agent。把「旧摘要 + 新近一批要折叠的原文轮次」合并成一份更新后的摘要,
// 供对话 agent 读取以记住超出原文窗口的早期内容(见 docs/conversation-agent.md#滚动摘要)。
// 纯文本、合并式增量(不从头重写)、目标语书写、长度受字符预算约束。

export interface SummarizeInput {
  targetLanguage: string;
  priorSummary: string; // 上一次的摘要,首次为空
  newTurns: string; // 待折叠的原文轮次(User/Partner 文本,时间正序)
  charBudget: number; // 输出摘要的字符上限(粗略对应 token 预算)
}

// 见 docs/conversation-agent.md#滚动摘要
function systemPrompt(input: SummarizeInput): string {
  return `You maintain a running summary of an ongoing language-learning conversation,
written in ${input.targetLanguage}. The summary is fed to a conversation partner so it
can remember earlier parts of the chat that have scrolled out of the verbatim window.

You are given the PRIOR summary and the NEW turns that are aging out of the window.
Merge them into ONE updated summary.

RULES
- Merge, do not rewrite from scratch. Keep everything still relevant from the prior
  summary; fold in what the new turns add.
- Preserve what matters for continuity: who/what was discussed, decisions or plans,
  facts the user shared, questions left open, and the current topic thread.
- Drop small talk and anything superseded. Be terse — this goes into every prompt.
- Stay strictly under ${input.charBudget} characters. If over budget, compress the
  oldest/least relevant points first.
- Write in ${input.targetLanguage}, as a compact factual recap (not a transcript,
  no "User said / Partner said" turn-by-turn). No headings, no code fences, no
  commentary — return ONLY the summary text.`;
}

function userPrompt(input: SummarizeInput): string {
  return `=== PRIOR SUMMARY ===
${input.priorSummary || "(none yet)"}

=== NEW TURNS TO FOLD IN ===
${input.newTurns}

Return the updated summary now.`;
}

// 去掉偶发的代码围栏(与 maintainer 同样的防御)。
function stripFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t
    .replace(/^```[a-zA-Z]*\n/, "")
    .replace(/\n```$/, "")
    .trim();
}

// 产出更新后的摘要文本。失败由调用方(summary-runner)兜底,不在此抛业务处理。
export async function summarizeConversation(
  provider: ModelProvider,
  input: SummarizeInput,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input) },
    { role: "user", content: userPrompt(input) },
  ];
  const out = await provider.generate({
    messages,
    temperature: 0.3,
    meta: { label: "summarize" },
  });
  return stripFences(out);
}
