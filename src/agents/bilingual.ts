import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";

export interface BilingualContext {
  nativeLanguage: string;
  targetLanguage: string;
  experiencePreferences: string;
  reply: string; // the conversation reply to render in bilingual view
  customInstructions?: string; // additional instructions appended by the user in the agent library
}

// Bilingual reading: rearrange a reply into Markdown — original text preserved sentence by sentence
// (including its own formatting), with native-language translation inlined after each sentence,
// wrapped in ⟦…⟧ markers. ⟦⟧ is not Markdown syntax and stays as-is in the text;
// the render layer (remark-bilingual) converts it to translation styling, avoiding * asterisks
// breaking next to CJK characters.
function systemPrompt(ctx: BilingualContext): string {
  const base = `You produce an interlinear bilingual reading view of a ${ctx.targetLanguage}
message for a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage}.

Reproduce the message in Markdown, KEEPING its original formatting and paragraph layout
(bold, lists, line breaks, etc.). After EACH ${ctx.targetLanguage} sentence, insert that
sentence's ${ctx.nativeLanguage} translation right after it, wrapped in ⟦ ⟧ brackets:

Original sentence one. ⟦母语翻译一⟧ Original sentence two. ⟦母语翻译二⟧

RULES
- Keep the ${ctx.targetLanguage} text EXACTLY as written — verbatim, do not edit or rephrase,
  preserving its original Markdown formatting (bold, lists, etc.).
- Translate naturally into ${ctx.nativeLanguage}, faithful to meaning and tone.
- Follow the learner experience preferences below for translation style and
  reading support, unless they conflict with preserving the original text.
- Wrap EVERY translation in ⟦ ⟧, placed right after its sentence. Use ⟦ ⟧ for
  nothing else.
- The translation inside ⟦ ⟧ must be PLAIN TEXT: no Markdown at all — no *, **, _,
  backticks, links, or brackets. Do NOT copy the original's bold/italics into it.
- Preserve the original paragraph breaks and any list/structure.
- No preamble, no numbering, no commentary, no code fences — just the interlinear message.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

function userPrompt(ctx: BilingualContext): string {
  return `=== MESSAGE ===
${ctx.reply}`;
}

// Strip ``` code fences that the model occasionally wraps around the output.
function stripFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1].trim() : t;
}

const MAX_OUTPUT_TOKENS = 4096;

// Returns the complete bilingual Markdown in one shot (not streaming). Rendering is handled by the Markdown component + em override.
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
  if (!md.trim())
    throw new Error("Bilingual layout generation failed, please retry");
  return md;
}
