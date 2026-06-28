import type { ChatMessage, ModelProvider } from "../providers/types";

export interface ExplainPointContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  experiencePreferences: string;
  profileSlice: string; // MD profile slice (qualitative mastery status)
  type: string; // mastery type: grammar | vocab | collocation | error_pattern | ...
  label: string; // the point to teach, e.g. "plural nouns", "third person -s"
  // The learner's own slip, when there is one (e.g. "foods → dishes"). Empty for
  // a review item they simply haven't used in a while.
  evidence?: string;
}

// On-demand mini-lesson for ONE mastery point surfaced in the coach panel. The
// goal is generalization (举一反三): teach the rule, contrast it with the
// learner's slip, and give fresh examples so they can transfer it — not just fix
// the one sentence (that already lives inline in the chat bubble).
function systemPrompt(ctx: ExplainPointContext): string {
  return `You are a patient ${ctx.targetLanguage} tutor for a ${ctx.nativeLanguage}
speaker at roughly ${ctx.level} level. The learner keeps running into ONE specific
point and wants to truly master it, not just patch a single sentence.

Your job: a short, focused mini-lesson on this ONE point so the learner can
generalize it to new sentences.

RULES
- Write the entire lesson IN ${ctx.nativeLanguage} (the learner's native language),
  but keep ${ctx.targetLanguage} for the example sentences themselves.
- Cover, briefly and concretely, in this order:
  1. The rule / pattern: what it is and how to form or use it (1–3 sentences).
  2. If a learner slip is given, point at the exact contrast — why their version
     was off and what the correct form is. Skip this step when no slip is given.
  3. 2–4 FRESH ${ctx.targetLanguage} example sentences (do NOT reuse the learner's),
     each with a short ${ctx.nativeLanguage} gloss, spanning varied contexts so the
     pattern transfers.
  4. One quick memory tip or "watch out for" note.
- Be concise and scannable. Short Markdown only (a line per example, minimal or no
  headers). No preamble, no closing pep talk.
- Follow the learner experience preferences and profile below to set depth and
  wording; explain at this learner's level, not in the abstract.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}`;
}

function userPrompt(ctx: ExplainPointContext): string {
  const slip = ctx.evidence?.trim()
    ? `Learner's slip: ${ctx.evidence.trim()}\n`
    : "";
  return `=== POINT TO TEACH ===
Type: ${ctx.type}
Point: ${ctx.label}
${slip}`;
}

// Plain-text streaming lesson. onDelta pushes chunks to the UI; returns the full text.
export async function explainPoint(
  provider: ModelProvider,
  ctx: ExplainPointContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream(
    { messages, temperature: 0.4, meta: { label: "explain-point" } },
    onDelta,
  );
}
