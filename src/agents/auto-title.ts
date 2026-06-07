import type { ChatMessage, ModelProvider } from "../providers/types";

export interface AutoTitleContext {
  targetLanguage: string;
  nativeLanguage: string;
  firstMessage: string;
}

const MAX_OUTPUT_TOKENS = 48;

export async function generateAutoTitle(
  provider: ModelProvider,
  ctx: AutoTitleContext,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `Generate a very short title for a ${ctx.targetLanguage} practice conversation that started with this message:

"${ctx.firstMessage.slice(0, 300)}"

Rules:
- Write the title in ${ctx.nativeLanguage} so it is easy to scan in a sidebar list
- Keep it very short — a few words (about 3–6 words, or 4–10 characters for languages like Chinese/Japanese)
- Capture the topic or situation, not the language itself
- No quotes, no trailing punctuation
- Return ONLY the title, nothing else`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 0.4,
    maxTokens: MAX_OUTPUT_TOKENS,
    meta: { label: "auto-title" },
  });

  const title = raw
    .trim()
    .replace(/^["']|["']$/g, "") // strip surrounding quotes
    .replace(/[.!?]$/, "") // strip trailing punctuation
    .trim();

  return title || "";
}
