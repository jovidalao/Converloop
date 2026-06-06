import { summarizeConversation } from "../agents/summarize";
import { getContextLimit, getProvider, loadConfig } from "../config";
import { getSummary, setSummary } from "../db/conversations";
import type { Turn } from "../db/schema";
import { formatTurns, getTurnsAfterId } from "../db/turns";
import { logError } from "../lib/log";
import { estimateTokens } from "../lib/tokens";

// Auto-compression: threshold-driven rolling summary for conversations. Runs in the background after each turn is persisted,
// folding the oldest verbatim turns in conversations approaching the context limit into a summary to free up window space.
// Never blocks the hot path; never throws (see docs/conversation-agent.md#rolling-summary).

// High/low water marks: compress when the estimated "conversation context (summary + verbatim)" tokens exceed 70% of the limit; compress down to ~50%
// (the low water mark prevents recompressing every turn).
const HIGH_WATER = 0.7;
const LOW_WATER = 0.5;

// Always keep at least this many verbatim turns; recent details are never lost (even when the budget is tiny).
const MIN_VERBATIM_TURNS = 6;

// Character limit for summary output (roughly corresponding to a token budget).
const SUMMARY_CHAR_BUDGET = 1500;

// Fixed reserve: system rule template + model reply output space. Dynamic blocks that grow with profile/data
// (profile / review / dataContext / agentPrompt) are passed in by the caller via dynamicContextTokens using actual estimates.
// History budget = limit * watermark − (BASE_RESERVE + dynamic blocks). The estimate is rough; the 30% headroom absorbs deviations.
const BASE_RESERVE = 1200;

// Token reserve for a not-yet-generated summary (conservatively converted from the character budget; used when calculating "how many verbatim turns to keep" to leave room for the summary).
const SUMMARY_RESERVE = Math.ceil(SUMMARY_CHAR_BUDGET / 3);

// Single-flight per conversation: only one compression job may run for the same conversation at a time.
const running = new Set<string>();

function tokensOfTurns(turns: Turn[]): number {
  return estimateTokens(formatTurns(turns));
}

// Decide the split point: keep as many verbatim turns as possible from newest to oldest such that
// (summary reserve + kept verbatim) ≤ lowBudget, and keep at least MIN_VERBATIM_TURNS turns.
// Returns the "oldest batch" of turns to fold into the summary (may be empty).
// Exported only for unit-testing boundary behavior.
export function pickFoldTurns(turns: Turn[], lowBudget: number): Turn[] {
  const minKeep = Math.min(MIN_VERBATIM_TURNS, turns.length);
  let keptTokens = SUMMARY_RESERVE;
  let keepCount = 0;
  // Accumulate from newest to oldest until adding one more turn would exceed lowBudget.
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = tokensOfTurns([turns[i]]);
    const isWithinMin = keepCount < minKeep;
    if (!isWithinMin && keptTokens + t > lowBudget) break;
    keptTokens += t;
    keepCount += 1;
  }
  const foldCount = turns.length - keepCount;
  return foldCount > 0 ? turns.slice(0, foldCount) : [];
}

async function runJob(
  conversationId: string,
  dynamicContextTokens: number,
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;

  const config = loadConfig();
  const limit = getContextLimit(config);
  const reserve = BASE_RESERVE + dynamicContextTokens;
  const highBudget = limit * HIGH_WATER - reserve;
  const lowBudget = limit * LOW_WATER - reserve;
  if (lowBudget <= 0) return; // Context limit is absurdly small; compression can't help. Abort.

  const { summary, throughId } = await getSummary(conversationId);
  const verbatim = await getTurnsAfterId(conversationId, throughId);

  const currentTokens = estimateTokens(summary ?? "") + tokensOfTurns(verbatim);
  if (currentTokens <= highBudget) return; // Not yet approaching the limit; skip.

  const foldTurns = pickFoldTurns(verbatim, lowBudget);
  if (foldTurns.length === 0) return; // Nothing left to compress (all turns are within the keep window).

  let newSummary: string;
  try {
    newSummary = await summarizeConversation(provider, {
      targetLanguage: config.targetLanguage,
      priorSummary: summary ?? "",
      newTurns: formatTurns(foldTurns),
      charBudget: SUMMARY_CHAR_BUDGET,
    });
  } catch (e) {
    // On failure, do not advance the watermark; retry together with this batch next time (consistent with the maintainer agent).
    logError("summary", "Summary generation failed", e);
    return;
  }
  if (!newSummary.trim()) return; // Empty summary: do not advance the watermark to avoid losing content.

  const newThroughId = foldTurns[foldTurns.length - 1].id;
  await setSummary(conversationId, newSummary, newThroughId);
}

// Called after each turn is persisted. Runs in the background, single-flight per conversation; never blocks the hot path; never throws.
// dynamicContextTokens: token estimate for the non-history dynamic block fed to the main agent this turn (profile / review / dataContext /
// agentPrompt), added on top of BASE_RESERVE to align the compression watermark with the actual load (especially for lesson sessions).
export async function maybeCompressConversation(
  conversationId: string,
  dynamicContextTokens = 0,
): Promise<void> {
  if (running.has(conversationId)) return;
  running.add(conversationId);
  try {
    await runJob(conversationId, dynamicContextTokens);
  } catch (e) {
    logError("summary", "Compression job error", e);
  } finally {
    running.delete(conversationId);
  }
}
