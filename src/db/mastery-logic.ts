import type { TutorAnalysis } from "../agents/schema";
import type { MasteryStatus, MasteryType, SignalKind } from "./mastery-values";

export type {
  MasteryStatus,
  MasteryType,
  SignalKind,
} from "./mastery-values";

// Pure logic: no DB, no Tauri, unit-testable. LLM provides discrete signals; this code computes counts/status.
// "gap" = user could not produce in the target language (native language/mixed), distinct from "error" (produced but incorrectly).

export interface Signal {
  key: string;
  label: string;
  type: MasteryType;
  kind: SignalKind;
  example?: string;
  note?: string; // additionally stored in mastery_item.notes (e.g. the idiomatic phrasing for an expression gap)
  payload?: unknown; // raw structured evidence, written to mastery_event for auditing / recomputation
}

export interface MasteryCounters {
  seenCount: number;
  errorCount: number;
  status: MasteryStatus;
  lastSeenAt: number;
}

export interface RetentionInput {
  seenCount: number;
  errorCount: number;
  status: MasteryStatus;
  lastSeenAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// mastery_key is the foundation of the mastery system: the same error type across sentences must use the same key.
// LLMs occasionally drift in casing/spacing (grammar:Article usage ↔ grammar:article_usage);
// without normalization this silently forks into two records and dilutes the counts.
// Normalize at the code boundary before writing (deriveSignals is the mandatory path for all signals).
export function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/_*:_*/g, ":") // no underscores around colons (type prefix separator)
    .replace(/^_|_$/g, "");
}

export function statusFromCounts(
  seenCount: number,
  errorCount: number,
): MasteryStatus {
  if (seenCount < 3) return "learning";
  const errRate = errorCount / seenCount;
  if (errRate > 0.4) return "struggling";
  if (errRate < 0.15) return "known";
  return "learning";
}

export function retentionStrengthDays(input: RetentionInput): number {
  const correctCount = Math.max(0, input.seenCount - input.errorCount);
  const accuracy = input.seenCount > 0 ? correctCount / input.seenCount : 0;
  const statusBoost =
    input.status === "known" ? 4 : input.status === "learning" ? 1 : 0;
  const raw =
    1 +
    correctCount * 1.6 +
    accuracy * 2 +
    statusBoost -
    input.errorCount * 0.5;
  return clamp(raw, 0.75, 30);
}

export function retentionScore(
  input: RetentionInput,
  now: number = Date.now(),
): number {
  if (!Number.isFinite(input.lastSeenAt) || input.lastSeenAt <= 0) return 0;
  const elapsedDays = Math.max(0, (now - input.lastSeenAt) / DAY_MS);
  return clamp(Math.exp(-elapsedDays / retentionStrengthDays(input)), 0, 1);
}

export function dueReviewScore(
  input: RetentionInput,
  now: number = Date.now(),
): number {
  const retention = retentionScore(input, now);
  const errorRate =
    input.seenCount > 0 ? input.errorCount / input.seenCount : 0.5;
  const statusNeed =
    input.status === "struggling"
      ? 1.25
      : input.status === "learning"
        ? 1
        : 0.7;
  return (1 - retention) * statusNeed + errorRate * 0.35;
}

// See docs/tutor-agent.md#accounting-in-code. Formulas can be tuned later; the key is that they live in code and are testable.
export function applySignal(
  prev: Pick<MasteryCounters, "seenCount" | "errorCount">,
  kind: SignalKind,
  now: number = Date.now(),
): MasteryCounters {
  // introduced = newly surfaced by the teacher/correction — exposure evidence only, not user production evidence.
  // It updates lastSeenAt and keeps the learning item alive, but does not push struggling→known.
  if (kind === "introduced") {
    return {
      seenCount: prev.seenCount,
      errorCount: prev.errorCount,
      status: statusFromCounts(prev.seenCount, prev.errorCount),
      lastSeenAt: now,
    };
  }

  const seenCount = prev.seenCount + 1;
  // gap counts as negative evidence just like error: user could not produce → pushes toward struggling.
  const errorCount =
    prev.errorCount + (kind === "error" || kind === "gap" ? 1 : 0);
  const status = statusFromCounts(seenCount, errorCount);
  return { seenCount, errorCount, status, lastSeenAt: now };
}

// issues[] → error signals (span_original treated as real error evidence);
// mastery_updates[] → correct / introduced signals.
// Error signals are derived solely from issues; the LLM must never re-report them via mastery_updates.
export function deriveSignals(analysis: TutorAnalysis): Signal[] {
  const signals: Signal[] = [];
  // Once a key in the same turn is claimed by negative evidence (error/gap) or an earlier signal,
  // subsequent correct/introduced signals must not count it again: otherwise the same message would
  // both report an error and report it correct, inflating seenCount and diluting the error rate.
  // Issues are not deduplicated against each other (repeated error = genuine repeated evidence).
  const claimed = new Set<string>();
  for (const issue of analysis.issues) {
    const key = normalizeKey(issue.mastery_key);
    signals.push({
      key,
      label: issue.mastery_label,
      type: issue.mastery_type,
      kind: "error",
      example: issue.span_original,
      payload: { issue },
    });
    claimed.add(key);
  }
  for (const update of analysis.mastery_updates) {
    const key = normalizeKey(update.key);
    if (claimed.has(key)) continue; // error takes priority; duplicate updates are also deduplicated
    signals.push({
      key,
      label: update.label,
      type: update.type,
      kind: update.signal,
      example: update.evidence,
      payload: { mastery_update: update },
    });
    claimed.add(key);
  }
  // Expression gap: record a gap signal for the scenario itself (storing the original + idiomatic phrasing); key items go through introduced.
  const gap = analysis.expression_gap;
  if (gap) {
    const gapKey = normalizeKey(gap.mastery_key);
    if (!claimed.has(gapKey)) {
      signals.push({
        key: gapKey,
        label: gap.mastery_label,
        type: "expression_gap",
        kind: "gap",
        example: gap.original, // most important: the original utterance the user could not produce
        note: gap.target_expression,
        payload: { expression_gap: gap },
      });
      claimed.add(gapKey);
    }
    for (const item of gap.key_items) {
      const key = normalizeKey(item.mastery_key);
      if (claimed.has(key)) continue;
      signals.push({
        key,
        label: item.mastery_label,
        type: item.mastery_type,
        kind: "introduced",
        example: item.text,
        payload: { key_item: item, expression_gap_key: gapKey },
      });
      claimed.add(key);
    }
  }
  return signals;
}
