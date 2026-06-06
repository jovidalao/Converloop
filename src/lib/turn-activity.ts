import type { TutorAnalysis } from "../agents/schema";
import { deriveSignals } from "../db/mastery-logic";
import type { ChatTurn } from "../db/turns";

// Pure adapter: maps a turn's tutor analysis + derived memory signals into a
// compact, typed activity list for the in-stream TurnCard summary (and, from
// Phase 6, the Coach inspector). Memory uses deriveSignals — the same function
// the code uses for accounting — so the in-stream count never drifts from what
// Coach shows or what gets written. Pure (no DB / Tauri): unit-testable.

export type TurnActivityKind = "tutor" | "memory";
export type TurnActivityStatus = "pending" | "ok" | "info" | "error";

export interface TurnActivity {
  kind: TurnActivityKind;
  status: TurnActivityStatus;
  label: string;
  /** Short preview text (corrected sentence, first signals…). */
  preview?: string;
  /** Step count (issues fixed, memory items…). */
  count?: number;
}

function tutorActivity(turn: ChatTurn): TurnActivity | null {
  if (turn.analysisPending) {
    return { kind: "tutor", status: "pending", label: "Grading…" };
  }
  const a = turn.analysis;
  if (!a) {
    const prose = turn.analysisProse?.trim();
    if (prose) {
      return {
        kind: "tutor",
        status: "ok",
        label: "This turn's feedback",
        preview: prose.slice(0, 80),
      };
    }
    if (turn.analysisError) {
      return { kind: "tutor", status: "error", label: turn.analysisError };
    }
    return null;
  }
  const gap = a.expression_gap;
  if (gap) {
    return {
      kind: "tutor",
      status: "info",
      label: "Expression gap",
      preview: gap.target_expression.trim() || gap.original.trim(),
    };
  }
  const issues = a.issues.length;
  const corrected = a.corrected.trim();
  const natural = a.natural.trim();
  const showCorrected = !!corrected && corrected !== turn.userText.trim();
  const showNatural = !!natural && natural !== corrected;
  if (issues === 0 && !showCorrected && !showNatural) {
    return { kind: "tutor", status: "ok", label: "Accurate, no changes needed" };
  }
  if (issues > 0) {
    return {
      kind: "tutor",
      status: "info",
      label: `Correction · ${issues} change${issues === 1 ? "" : "s"}`,
      count: issues,
      preview: showCorrected ? corrected : undefined,
    };
  }
  return {
    kind: "tutor",
    status: "ok",
    label: "More natural phrasing",
    preview: showNatural ? natural : showCorrected ? corrected : undefined,
  };
}

function memoryActivity(analysis: TutorAnalysis): TurnActivity | null {
  const signals = deriveSignals(analysis);
  if (signals.length === 0) return null;
  return {
    kind: "memory",
    status: "info",
    label: `Recorded ${signals.length} item${signals.length === 1 ? "" : "s"}`,
    count: signals.length,
    preview: signals
      .slice(0, 3)
      .map((s) => s.label)
      .join(" · "),
  };
}

// Off-record (/btw) turns aren't graded and write no memory → no activities.
export function deriveTurnActivities(turn: ChatTurn): TurnActivity[] {
  if (turn.excludeFromContext) return [];
  const out: TurnActivity[] = [];
  const tutor = tutorActivity(turn);
  if (tutor) out.push(tutor);
  if (turn.analysis) {
    const memory = memoryActivity(turn.analysis);
    if (memory) out.push(memory);
  }
  return out;
}
