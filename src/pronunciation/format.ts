import type { PronunciationAssessment } from "./types";

// Render an assessment into the Coach-panel annotation body (Markdown). Pure so it's unit-testable and
// degrades gracefully: a dedicated API fills word scores/phonemes, an LLM may only fill notes — both read
// fine. Returns "" when there's nothing worth showing, so the caller can fall back to a "sounds good" note.
export function formatPronunciationBody(a: PronunciationAssessment): string {
  const lines: string[] = [];
  if (typeof a.overall === "number") {
    lines.push(`**${Math.round(a.overall)} / 100**`);
  }
  if (a.notes?.trim()) lines.push(a.notes.trim());

  // Flag words with an explicit issue, or a low score even when the model gave no prose.
  const flagged = a.words.filter(
    (w) => w.issue?.trim() || (typeof w.score === "number" && w.score < 80),
  );
  if (flagged.length > 0) {
    if (lines.length > 0) lines.push("");
    for (const w of flagged) {
      const score =
        typeof w.score === "number" ? ` (${Math.round(w.score)})` : "";
      const ipa =
        w.phonemes && w.phonemes.length > 0
          ? ` /${w.phonemes.map((p) => p.ipa).join("")}/`
          : "";
      const issue = w.issue?.trim() ? ` — ${w.issue.trim()}` : "";
      lines.push(`- **${w.text}**${ipa}${score}${issue}`);
    }
  }
  return lines.join("\n").trim();
}
