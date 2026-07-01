import { generateConversationTopics } from "../agents/conversation-topics";
import {
  cleanInputHintForDisplay,
  generateInputHints,
} from "../agents/input-hints";
import { generateQuickfireTopics } from "../agents/quickfire-topics";
import { getProvider, loadConfig } from "../config";
import { getAppState, setAppState } from "../db/app-state";
import {
  DEFAULT_CONVERSATION_TITLE,
  getConversation,
  getConversationModelOverride,
  listConversations,
} from "../db/conversations";
import { getReviewDueList, getWeakList } from "../db/mastery";
import { formatTurns, getTurnsAfterId } from "../db/turns";
import { emitAppEvent } from "../lib/app-events";
import { profileSliceForConversation, readProfile } from "../profile/profile";
import {
  type CachedInputHints,
  INPUT_HINTS_CACHE_PREFIX,
  tailTurnsByChars,
} from "./shared";

// Load cached hints for a conversation, but only if they were generated for the current
// last-turn watermark. Returns [] on miss/stale/corrupt so callers can regenerate.
export async function loadCachedInputHints(
  conversationId: string,
  throughTurnId: string | null,
): Promise<string[]> {
  const raw = await getAppState(INPUT_HINTS_CACHE_PREFIX + conversationId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as CachedInputHints;
    if (parsed.throughTurnId === throughTurnId && Array.isArray(parsed.hints)) {
      return parsed.hints
        .filter((hint): hint is string => typeof hint === "string")
        .map(cleanInputHintForDisplay)
        .filter((hint) => hint.length > 0);
    }
  } catch {
    // Corrupt cache entry — treat as a miss.
  }
  return [];
}

// Generate short coaching hints for the next user reply based on recent conversation history,
// and cache them keyed by the conversation's last-turn watermark.
// reuseCached: return the cached hint when it matches the current watermark instead of
// regenerating — the post-reply path passes this so an in-band [[HINT]] trailer (cached by
// runTurn) makes the standalone fallback call unnecessary. Manual regenerate omits it.
// Returns an empty array on any error so callers can silently degrade.
export async function generateInputHintsForConversation(
  conversationId: string,
  opts: { reuseCached?: boolean } = {},
): Promise<string[]> {
  const conversation = await getConversation(conversationId);
  const provider = await getProvider(
    getConversationModelOverride(conversation),
  );
  if (!provider) return [];

  const config = loadConfig();
  try {
    const turns = await getTurnsAfterId(conversationId, null);
    if (opts.reuseCached) {
      const throughTurnId = turns[turns.length - 1]?.id ?? null;
      const cached = await loadCachedInputHints(conversationId, throughTurnId);
      if (cached.length > 0) return cached;
    }
    const [profileMd, dueReview, weakList] = await Promise.all([
      readProfile(config),
      getReviewDueList(5),
      getWeakList(8),
    ]);
    const recent = tailTurnsByChars(turns, 4000);
    const recentHistory = formatTurns(recent);
    // Re-practice candidates for the hint: spaced-repetition picks first (retention
    // has decayed per dueReviewScore — the same forgetting model the conversation
    // agent's DUE-FOR-REVIEW list uses), then recent weak items to fill. Recently
    // missed items are still fresh in memory; the fading ones are where a quiet
    // re-exposure pays. Listening/drill keys are excluded by both queries.
    const dueKeys = new Set(dueReview.map((item) => item.key));
    const rePractice = [
      ...dueReview,
      ...weakList.filter((w) => !dueKeys.has(w.key)),
    ].slice(0, 8);
    const pastMistakes = rePractice
      .map((w) => {
        const note = w.notes?.trim();
        return `- ${w.label}${note ? ` (${note})` : ""}`;
      })
      .join("\n");
    const hints = await generateInputHints(provider, {
      targetLanguage: config.targetLanguage,
      nativeLanguage: config.nativeLanguage,
      level: config.level,
      recentHistory,
      profileSlice: profileSliceForConversation(profileMd),
      pastMistakes,
    });
    if (hints.length > 0) {
      const throughTurnId = turns[turns.length - 1]?.id ?? null;
      await setAppState(
        INPUT_HINTS_CACHE_PREFIX + conversationId,
        JSON.stringify({ throughTurnId, hints } satisfies CachedInputHints),
      );
      emitAppEvent("input-hints-changed", { conversationId });
    }
    return hints;
  } catch {
    return [];
  }
}

// Cached topic recommendations (one global list per start page, derived from the learner's records rather than any one
// conversation). The start page reuses this list verbatim on every open — no model call, no record reads — so
// reopening Rapid Q&A / new chat is instant and stable. The first generated set sticks until the learner taps
// Regenerate, which forces a fresh set. The cache holds just the topic strings; nothing else.
const QUICKFIRE_TOPICS_CACHE_KEY = "quickfireTopics";
const CONVERSATION_TOPICS_CACHE_KEY = "conversationTopics";

// Read the cached chip list. Accepts both the current bare-array shape and the legacy { topics, signature } wrapper so
// existing caches survive the upgrade without a forced regenerate.
async function loadCachedTopics(key: string): Promise<string[]> {
  const raw = await getAppState(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed as { topics?: unknown } | null)?.topics;
    if (Array.isArray(arr) && arr.every((s) => typeof s === "string"))
      return arr as string[];
  } catch {
    // Corrupt cache entry — treat as a miss.
  }
  return [];
}

export async function loadCachedQuickfireTopics(): Promise<string[]> {
  return loadCachedTopics(QUICKFIRE_TOPICS_CACHE_KEY);
}

// Generate umbrella scenarios for the rapid-fire Q&A start page from the learner's records: weak mastery items,
// profile, and recent conversation topics (with everyday corner cases when records are thin). Always generates — the
// start page only calls this on a cold cache or an explicit Regenerate (opts.avoid) — then caches the result so the
// next open reuses it without a model call. Never throws — returns an empty list on failure so the start page degrades
// to the cached set (or type-your-own).
export async function recommendQuickfireTopics(opts?: {
  avoid?: string[];
}): Promise<string[]> {
  const config = loadConfig();
  const avoid = opts?.avoid ?? [];
  const provider = await getProvider();
  if (!provider) return [];

  try {
    const [weakList, profileMd, convs] = await Promise.all([
      getWeakList(),
      readProfile(config),
      listConversations(),
    ]);
    const recentTopics = convs
      .filter(
        (c) => c.kind === "practice" && c.title !== DEFAULT_CONVERSATION_TITLE,
      )
      .slice(0, 8)
      .map((c) => c.title);
    const profileSlice = profileSliceForConversation(profileMd);
    const weakItems = weakList.map((w) => w.label);

    let usedFallback = false;
    const topics = await generateQuickfireTopics(
      provider,
      {
        targetLanguage: config.targetLanguage,
        nativeLanguage: config.nativeLanguage,
        level: config.level,
        profileSlice,
        weakItems,
        recentTopics,
        avoid,
      },
      (info) => {
        usedFallback = info.usedFallback;
      },
    );
    // Cache only a genuine model result — never the hardcoded fallback, so a transient failure retries next time
    // rather than pinning the fallback list.
    if (topics.length > 0 && !usedFallback) {
      await setAppState(QUICKFIRE_TOPICS_CACHE_KEY, JSON.stringify(topics));
    }
    return topics;
  } catch {
    return [];
  }
}

export async function loadCachedConversationTopics(): Promise<string[]> {
  return loadCachedTopics(CONVERSATION_TOPICS_CACHE_KEY);
}

// Per-drill chip cache for drills that customize their recommender via a # Setup section (drills
// without guidance share the general conversation-topics cache).
const DRILL_TOPICS_CACHE_PREFIX = "drillTopics:";

export async function loadCachedDrillTopics(
  drillId: string,
): Promise<string[]> {
  return loadCachedTopics(DRILL_TOPICS_CACHE_PREFIX + drillId);
}

// Generate conversation topics for the new-chat start page from the learner's profile and recent conversation topics
// (with broadly relatable everyday topics when records are thin). Mirrors recommendQuickfireTopics: always generates —
// the start page only calls this on a cold cache or an explicit Regenerate (opts.avoid) — then caches the result so
// the next open reuses it without a model call. Never throws — returns an empty list on failure so the start page
// degrades to the cached set (or type-your-own).
export async function recommendConversationTopics(opts?: {
  avoid?: string[];
  /** Drill start pages: the drill's # Setup guidance; results cache per drill instead of globally. */
  drill?: { id: string; guidance: string };
}): Promise<string[]> {
  const config = loadConfig();
  const avoid = opts?.avoid ?? [];
  const provider = await getProvider();
  if (!provider) return [];

  try {
    const [profileMd, convs] = await Promise.all([
      readProfile(config),
      listConversations(),
    ]);
    const recentTopics = convs
      .filter(
        (c) => c.kind === "practice" && c.title !== DEFAULT_CONVERSATION_TITLE,
      )
      .slice(0, 8)
      .map((c) => c.title);
    const profileSlice = profileSliceForConversation(profileMd);

    let usedFallback = false;
    const topics = await generateConversationTopics(
      provider,
      {
        targetLanguage: config.targetLanguage,
        nativeLanguage: config.nativeLanguage,
        level: config.level,
        profileSlice,
        recentTopics,
        avoid,
        drillGuidance: opts?.drill?.guidance,
      },
      (info) => {
        usedFallback = info.usedFallback;
      },
    );
    if (topics.length > 0 && !usedFallback) {
      await setAppState(
        opts?.drill
          ? DRILL_TOPICS_CACHE_PREFIX + opts.drill.id
          : CONVERSATION_TOPICS_CACHE_KEY,
        JSON.stringify(topics),
      );
    }
    return topics;
  } catch {
    return [];
  }
}
