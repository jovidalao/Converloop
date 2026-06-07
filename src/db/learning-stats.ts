import { count, desc, gt } from "drizzle-orm";
import { db } from "./client";
import type { MasteryType } from "./mastery-values";
import { masteryItem, turn } from "./schema";

// Read-only learning-achievements stats for the records page. Pure helpers
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

export interface MistakeRow {
  key: string;
  label: string;
  type: MasteryType;
  errorCount: number;
  seenCount: number;
  example: string | null;
  lastSeenAt: number;
}

export interface LearningStats {
  totalSentences: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  mastered: number;
  learning: number;
  struggling: number;
  totalKnowledge: number;
  mistakeTotal: number;
  /** localDayNumber → sentences practiced that day. */
  dayCounts: Map<number, number>;
  /** Top items the user has gotten wrong, most-missed first (capped). */
  mistakes: MistakeRow[];
}

const MISTAKE_LIMIT = 12;

export async function getLearningStats(): Promise<LearningStats> {
  const today = localDayNumber(Date.now());

  const turns = await db.select({ createdAt: turn.createdAt }).from(turn);
  const dayCounts = new Map<number, number>();
  for (const row of turns) {
    const day = localDayNumber(row.createdAt);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  const { current, longest } = computeStreaks(dayCounts.keys(), today);

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

  const mistakeRows = await db
    .select({
      key: masteryItem.key,
      label: masteryItem.label,
      type: masteryItem.type,
      errorCount: masteryItem.errorCount,
      seenCount: masteryItem.seenCount,
      example: masteryItem.example,
      lastSeenAt: masteryItem.lastSeenAt,
    })
    .from(masteryItem)
    .where(gt(masteryItem.errorCount, 0))
    .orderBy(desc(masteryItem.errorCount), desc(masteryItem.lastSeenAt));

  return {
    totalSentences: turns.length,
    activeDays: dayCounts.size,
    currentStreak: current,
    longestStreak: longest,
    mastered,
    learning,
    struggling,
    totalKnowledge: mastered + learning + struggling,
    mistakeTotal: mistakeRows.length,
    dayCounts,
    mistakes: mistakeRows.slice(0, MISTAKE_LIMIT),
  };
}
