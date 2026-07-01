import type { TutorAnalysis } from "../agents/schema";
import type { AppConfig } from "../config";
import type { AgentModifiers } from "../db/conversations";
import { getSummary } from "../db/conversations";
import {
  getComfortableList,
  getMasteryKeyHints,
  getReviewDueList,
  getWeakList,
} from "../db/mastery";
import { getProficiencySnapshot } from "../db/proficiency";
import { getTurnsAfterId } from "../db/turns";
import type { DrillRenderExtras } from "../drills/render";
import { getDrill } from "../drills/store";
import type { ResolvedDrill } from "../drills/types";
import { staticT } from "../i18n";
import { estimateTokens } from "../lib/tokens";
import { readProfile } from "../profile/profile";
import type { ConversationCallbacks } from "../runtime";

// Callback shape is defined centrally in runtime (ConversationCallbacks); this alias export preserves existing references.
export type TurnCallbacks = ConversationCallbacks;

export interface TurnResult {
  reply: string;
  analysis: TutorAnalysis | null;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(staticT("errors.missingApiKey"));
    this.name = "MissingApiKeyError";
  }
}

// Cache of generated input hints, keyed per conversation. Stored in app_state (SQLite) so
// hints survive switching away and reopening the conversation, and app restarts.
// throughTurnId is the last on-record turn at generation time (the watermark): hints reflect
// the conversation state after that turn, so a different last turn means the cache is stale.
// Written by turn-runner's runTurn (in-band [[HINT]] trailer) and read/written by
// topics-and-hints' generateInputHintsForConversation — shared here so both agree on the key/shape.
export const INPUT_HINTS_CACHE_PREFIX = "inputHints:";

export interface CachedInputHints {
  throughTurnId: string | null;
  hints: string[];
}

// Resolve the drill behind a conversation's modifiers. Prompt prose (task/opening/setup guidance)
// comes from the LIVE drill row when it still exists — editing a drill updates its open sessions —
// while the mechanics enums (interaction/grading/mastery/…) stay frozen on the modifier snapshot so
// an in-flight session never changes shape mid-conversation. A deleted drill falls back entirely to
// the snapshot, so old conversations keep working.
export async function resolveDrill(
  mods: AgentModifiers,
): Promise<ResolvedDrill | undefined> {
  const marker = mods.drill;
  if (!marker) return undefined;
  try {
    const live = await getDrill(marker.modeId);
    if (live) {
      return {
        modeId: marker.modeId,
        params: marker.params,
        def: {
          ...marker.def,
          task: live.def.task,
          opening: live.def.opening,
          setupGuidance: live.def.setupGuidance,
        },
      };
    }
  } catch {
    // Store unavailable — snapshot below keeps the session alive.
  }
  return { modeId: marker.modeId, params: marker.params, def: marker.def };
}

export function drillLangExtras(config: AppConfig): DrillRenderExtras {
  return {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };
}

export function tailTurnsByChars<
  T extends { userInput: string; reply: string },
>(turns: T[], charBudget: number): T[] {
  let used = 0;
  let start = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const next = turns[i];
    const cost = next.userInput.length + next.reply.length + 32;
    if (used + cost > charBudget && start < turns.length) break;
    used += cost;
    start = i;
  }
  return turns.slice(start);
}

// Shared per-turn data fetching for runTurn and startDerivedConversation: summary + global mastery table + profile,
// fetched once in parallel (all independent, avoids stacking latency). Per-caller rankMasteryItemsForInput
// (whose query/context differs between hot path and derived opening) is handled by each caller.
export async function loadTurnContextData(
  conversationId: string,
  config: AppConfig,
) {
  const [
    summaryData,
    weakListRaw,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
    keyHints,
  ] = await Promise.all([
    getSummary(conversationId),
    getWeakList(),
    readProfile(config),
    getComfortableList(),
    getReviewDueList(),
    getProficiencySnapshot(),
    getMasteryKeyHints(),
  ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  return {
    summaryData,
    weakListRaw,
    profileMd,
    comfortableItemsRaw,
    reviewItemsRaw,
    proficiency,
    keyHints,
    verbatimTurns,
  };
}

// Token estimate for the "non-history dynamic block" used by the auto-compression watermark: profile slice + mastered scaffold + review candidates.
export function estimateNonHistoryTokens(
  profileSlice: string,
  comfortableItems: {
    label: string;
    example?: string | null;
    notes?: string | null;
  }[],
  reviewItems: {
    label: string;
    example?: string | null;
    notes?: string | null;
  }[],
): number {
  const listText = (
    items: { label: string; example?: string | null; notes?: string | null }[],
  ) =>
    items
      .map((r) => `${r.label} ${r.example ?? ""} ${r.notes ?? ""}`)
      .join("\n");
  return (
    estimateTokens(profileSlice) +
    estimateTokens(listText(comfortableItems)) +
    estimateTokens(listText(reviewItems))
  );
}
