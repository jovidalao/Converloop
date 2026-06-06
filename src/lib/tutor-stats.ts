import { logDebug } from "./log";

// Health of the tutor's structured output: JSON parse succeeded vs fell back to prose vs completely failed.
// The fallback/failure paths only display corrections and do not update mastery (see orchestrator), so a high fallback rate means
// the mastery system is silently degrading and review signals are being lost. Accumulated in-process for observability; not persisted.
export interface TutorStats {
  structured: number;
  prose: number;
  failed: number;
}

export type TutorOutcome = keyof TutorStats;

const stats: TutorStats = { structured: 0, prose: 0, failed: 0 };

// Fraction of turns where "correction is visible but not accounted" (prose + failed).
export function degradedRate(s: TutorStats): number {
  const total = s.structured + s.prose + s.failed;
  return total === 0 ? 0 : (s.prose + s.failed) / total;
}

export function recordTutorOutcome(outcome: TutorOutcome): void {
  stats[outcome]++;
  const total = stats.structured + stats.prose + stats.failed;
  const rate = degradedRate(stats);
  // When the cumulative fallback rate is high, warn directly (not gated by the debug flag); otherwise only log a line under debug.
  if (outcome !== "structured" && total >= 5 && rate >= 0.2) {
    console.warn(
      `[tutor] High structured-output fallback rate: ${stats.prose + stats.failed}/${total} (${Math.round(rate * 100)}%) — these turns were not counted towards mastery`,
    );
  } else {
    logDebug(
      "tutor",
      `outcome=${outcome} structured=${stats.structured} prose=${stats.prose} failed=${stats.failed}`,
    );
  }
}

export function getTutorStats(): Readonly<TutorStats> {
  return stats;
}
