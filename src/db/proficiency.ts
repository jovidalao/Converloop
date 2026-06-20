import { count, eq } from "drizzle-orm";
import {
  computeProficiency,
  type ProficiencyMetrics,
  type ProficiencySnapshot,
} from "../lib/proficiency";
import { db } from "./client";
import type { MasteryStatus } from "./mastery-logic";
import { masteryItem } from "./schema";
import { getRecentProductionTurns, parseTurnFeedback } from "./turns";

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

async function statusCount(status: MasteryStatus): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(masteryItem)
    .where(eq(masteryItem.status, status));
  return row?.n ?? 0;
}

// Aggregate evidence metrics from recent turns (global — proficiency is a global characteristic) + mastery table.
// Gap turns (native-language fallback) are excluded from output length/accuracy metrics; they only count toward gapRate.
// Dictation turns are excluded entirely (see getRecentProductionTurns): one 10-sentence drill would
// otherwise fill the window and turn listening slips into "production errors", silently easing every conversation.
export async function getProficiencyInput(
  limit = 20,
): Promise<ProficiencyMetrics> {
  const turns = await getRecentProductionTurns(limit);
  let analyzed = 0;
  let nonGapTurns = 0;
  let words = 0;
  let issues = 0;
  let gapTurns = 0;
  let assists = 0;
  for (const t of turns) {
    assists += (t.explainCount ?? 0) + (t.bilingualCount ?? 0);
    const { analysis } = parseTurnFeedback(t.analysisJson);
    if (!analysis) continue;
    analyzed++;
    if (analysis.expression_gap) {
      gapTurns++;
      continue;
    }
    nonGapTurns++;
    words += wordCount(t.userInput);
    issues += analysis.issues.length;
  }
  const [knownCount, strugglingCount] = await Promise.all([
    statusCount("known"),
    statusCount("struggling"),
  ]);
  return {
    sampleTurns: analyzed,
    avgInputWords: nonGapTurns ? words / nonGapTurns : 0,
    errorsPer100Words: words ? (issues / words) * 100 : 0,
    gapRate: analyzed ? gapTurns / analyzed : 0,
    assistRate: turns.length ? assists / turns.length : 0,
    knownCount,
    strugglingCount,
  };
}

export async function getProficiencySnapshot(
  limit = 20,
): Promise<ProficiencySnapshot> {
  return computeProficiency(await getProficiencyInput(limit));
}
