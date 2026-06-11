import { count } from "drizzle-orm";
import { db } from "./client";
import { masteryItem, turn } from "./schema";

// Read-only learning-achievements stats for the practice-stats card. Pure helpers
// (localDayNumber / computeStreaks) are unit-tested; getLearningStats just wires
// them to the DB. Aggregation is done in JS over a thin column projection — the
// row counts here (turns, mastery items) are small enough that this stays cheap
// and avoids SQLite date-bucketing quirks.

// Integer index of the local calendar day a timestamp falls on. Built from the
// local Y/M/D via Date.UTC so the value is monotonic and DST-safe: consecutive
// calendar days always differ by exactly 1.
export function localDayNumber(ts: number): number {
  const d = new Date(ts);
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
}

// Current + longest consecutive-day streaks from a set of active day numbers.
// The current streak stays "alive" if the most recent practice was today or
// yesterday; a two-day gap resets it to 0 (Duolingo semantics).
export function computeStreaks(
  days: Iterable<number>,
  today: number,
): { current: number; longest: number } {
  const set = new Set(days);
  if (set.size === 0) return { current: 0, longest: 0 };

  const sorted = [...set].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  let cursor = set.has(today) ? today : set.has(today - 1) ? today - 1 : null;
  let current = 0;
  while (cursor !== null && set.has(cursor)) {
    current++;
    cursor--;
  }

  return { current, longest };
}

export function isCountablePracticeTurn(input: {
  userInput: string;
  displayText: string | null;
  excludeFromContext: number;
}): boolean {
  if (input.excludeFromContext) return false;
  if (input.displayText) return false;
  return input.userInput.trim().length > 0;
}

export interface LearningStats {
  totalSentences: number;
  activeDays: number;
  currentStreak: number;
  mastered: number;
  learning: number;
  struggling: number;
  totalKnowledge: number;
  /** localDayNumber → sentences practiced that day. */
  dayCounts: Map<number, number>;
}

export async function getLearningStats(): Promise<LearningStats> {
  const today = localDayNumber(Date.now());

  const turns = (
    await db
      .select({
        createdAt: turn.createdAt,
        userInput: turn.userInput,
        displayText: turn.displayText,
        excludeFromContext: turn.excludeFromContext,
      })
      .from(turn)
  ).filter(isCountablePracticeTurn);
  const dayCounts = new Map<number, number>();
  for (const row of turns) {
    const day = localDayNumber(row.createdAt);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const { current } = computeStreaks(dayCounts.keys(), today);

  const statusRows = await db
    .select({ status: masteryItem.status, n: count() })
    .from(masteryItem)
    .groupBy(masteryItem.status);
  let mastered = 0;
  let learning = 0;
  let struggling = 0;
  for (const row of statusRows) {
    if (row.status === "known") mastered = row.n;
    else if (row.status === "learning") learning = row.n;
    else if (row.status === "struggling") struggling = row.n;
  }

  return {
    totalSentences: turns.length,
    activeDays: dayCounts.size,
    currentStreak: current,
    mastered,
    learning,
    struggling,
    totalKnowledge: mastered + learning + struggling,
    dayCounts,
  };
}
