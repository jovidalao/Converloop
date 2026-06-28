import type { Issue, TutorAnalysis } from "../agents/schema";
import type { ReviewItem } from "../db/mastery";
import { isIsolatedDrillKey } from "../db/mastery";
import type { ChatTurn } from "../db/turns";

// The coach panel shows one adaptive "focus" — the single most useful thing about
// where the conversation is right now — instead of a static dashboard. This module
// is the pure decision logic (priority ladder); the component only renders the
// result. Keeping it here makes the priorities unit-testable.

const SEVERITY_RANK: Record<Issue["severity"], number> = {
  major: 3,
  moderate: 2,
  minor: 1,
};

// Same key appears as an error in this many distinct graded turns → recurring.
const RECURRING_THRESHOLD = 2;

export type CoachFocus =
  | { kind: "empty" }
  | { kind: "clean"; turnId: string }
  | {
      kind: "gap";
      turnId: string;
      masteryKey: string;
      original: string;
      target: string;
      template?: string;
    }
  | {
      kind: "fix";
      turnId: string;
      masteryKey: string;
      label: string;
      type: string;
      original: string;
      corrected: string;
      explanation?: string;
      severity: Issue["severity"];
    }
  | {
      kind: "recurring";
      turnId: string;
      masteryKey: string;
      label: string;
      type: string;
      count: number;
      original: string;
      corrected: string;
    }
  | { kind: "praise"; turnId: string; highlight: string };

export interface CoachRecall {
  key: string;
  label: string;
  type: string;
  example: string | null;
}

export interface CoachFocusResult {
  focus: CoachFocus;
  recall: CoachRecall | null;
}

function topIssue(issues: Issue[]): Issue | null {
  let best: Issue | null = null;
  for (const issue of issues) {
    if (!best || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[best.severity]) {
      best = issue;
    }
  }
  return best;
}

function fixFocus(turnId: string, issue: Issue): CoachFocus {
  return {
    kind: "fix",
    turnId,
    masteryKey: issue.mastery_key,
    label: issue.mastery_label,
    type: issue.mastery_type,
    original: issue.span_original,
    corrected: issue.span_corrected,
    explanation: issue.explanation?.trim() || undefined,
    severity: issue.severity,
  };
}

// Count how many distinct graded turns each mastery_key shows up in as an error,
// keeping the most recent occurrence's example. The most-repeated key (≥ threshold)
// wins; ties go to the more recent turn (turns iterate oldest → newest).
function recurringFocus(graded: ChatTurn[]): CoachFocus | null {
  const counts = new Map<
    string,
    {
      count: number;
      label: string;
      type: string;
      turnId: string;
      original: string;
      corrected: string;
    }
  >();
  for (const turn of graded) {
    const seenInTurn = new Set<string>();
    for (const issue of turn.analysis?.issues ?? []) {
      const key = issue.mastery_key;
      if (!key || isIsolatedDrillKey(key) || seenInTurn.has(key)) continue;
      seenInTurn.add(key);
      const prev = counts.get(key);
      if (prev) {
        prev.count += 1;
        prev.turnId = turn.id;
        prev.original = issue.span_original;
        prev.corrected = issue.span_corrected;
      } else {
        counts.set(key, {
          count: 1,
          label: issue.mastery_label,
          type: issue.mastery_type,
          turnId: turn.id,
          original: issue.span_original,
          corrected: issue.span_corrected,
        });
      }
    }
  }
  let best: {
    key: string;
    v: NonNullable<ReturnType<typeof counts.get>>;
  } | null = null;
  for (const [key, v] of counts) {
    if (v.count < RECURRING_THRESHOLD) continue;
    if (!best || v.count >= best.v.count) best = { key, v };
  }
  if (!best) return null;
  return {
    kind: "recurring",
    turnId: best.v.turnId,
    masteryKey: best.key,
    label: best.v.label,
    type: best.v.type,
    count: best.v.count,
    original: best.v.original,
    corrected: best.v.corrected,
  };
}

function pickFocus(graded: ChatTurn[]): CoachFocus {
  if (graded.length === 0) return { kind: "empty" };
  const latest = graded[graded.length - 1];
  const a = latest.analysis as TutorAnalysis;

  // 1. A fresh expression gap (the learner literally couldn't say something) is
  // the most urgent thing to resolve.
  const gap = a.expression_gap;
  if (gap?.original.trim() && gap.target_expression.trim()) {
    return {
      kind: "gap",
      turnId: latest.id,
      masteryKey: gap.mastery_key,
      original: gap.original.trim(),
      target: gap.target_expression.trim(),
      template: gap.template?.trim() || undefined,
    };
  }

  const latestTop = topIssue(a.issues);

  // 2. A brand-new major mistake outranks an older recurring one.
  if (latestTop?.severity === "major") return fixFocus(latest.id, latestTop);

  // 3. A pattern the learner keeps repeating is worth more than a one-off minor slip.
  const recurring = recurringFocus(graded);
  if (recurring) return recurring;

  // 4. Otherwise surface the latest sentence's top (moderate/minor) fix.
  if (latestTop) return fixFocus(latest.id, latestTop);

  // 5. Clean sentence with something notable → praise it.
  const highlight = a.highlight?.trim();
  if (highlight && a.is_correct) {
    return { kind: "praise", turnId: latest.id, highlight };
  }

  // 6. Clean, nothing to flag — gentle "keep going".
  return { kind: "clean", turnId: latest.id };
}

// dueItems is already sorted weakest-first (retention asc). Pick the first real
// review item, skipping the one already shown as the focus.
function pickRecall(
  dueItems: ReviewItem[],
  excludeKey: string | null,
): CoachRecall | null {
  for (const item of dueItems) {
    if (isIsolatedDrillKey(item.key)) continue;
    if (excludeKey && item.key === excludeKey) continue;
    return {
      key: item.key,
      label: item.label,
      type: item.type,
      example: item.example,
    };
  }
  return null;
}

export function resolveCoachFocus(
  turns: ChatTurn[],
  dueItems: ReviewItem[],
): CoachFocusResult {
  // Graded, on-record, learner-produced turns (newest last). Prompt-macro turns
  // (displayText) and off-record /btw turns are directives, not learner output.
  const graded = turns.filter(
    (t) => !t.excludeFromContext && !t.displayText && t.analysis,
  );
  const focus = pickFocus(graded);
  const focusKey = "masteryKey" in focus ? focus.masteryKey : null;
  return { focus, recall: pickRecall(dueItems, focusKey) };
}
