import type { ChatMessage, ModelProvider } from "../providers/types";

// Conversation rolling-summary agent. Merges the "old summary + a recent batch of verbatim turns to fold in"
// into an updated summary, read by the conversation agent to remember earlier content that has scrolled
// out of the verbatim window (see docs/conversation-agent.md#rolling-summary).
// Plain text, incremental merge (not rewritten from scratch), written in the target language, length constrained by character budget.

export interface SummarizeInput {
  targetLanguage: string;
  priorSummary: string; // the previous summary; empty on first run
  newTurns: string; // verbatim turns to fold in (User/Partner text, chronological order)
  charBudget: number; // character limit for the output summary (rough token budget proxy)
}

// See docs/conversation-agent.md#rolling-summary
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

// Strip occasional code fences (same defensive measure as in maintainer).
function stripFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t
    .replace(/^```[a-zA-Z]*\n/, "")
    .replace(/\n```$/, "")
    .trim();
}

// Produces the updated summary text. Failures are caught by the caller (summary-runner); no business error handling here.
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
