import type { ChatMessage, ModelProvider } from "../providers/types";

export interface AutoTitleContext {
  targetLanguage: string;
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
      content: `Generate a short title (3–6 words) for a ${ctx.targetLanguage} language-learning conversation that started with this message:

"${ctx.firstMessage.slice(0, 300)}"

Rules:
- 3–6 words, no quotes, no punctuation at the end
- Capture the topic or situation, not the language itself
- English is fine regardless of the target language
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
