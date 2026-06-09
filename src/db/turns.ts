import { and, count, desc, eq, gt, gte, sql } from "drizzle-orm";
import type { HistoryTurn } from "../agents/history-messages";
import type { TutorAnalysis } from "../agents/schema";
import { db } from "./client";
import { normalizeKey } from "./mastery-logic";
import { type Turn, turn } from "./schema";

export async function persistTurn(
  conversationId: string,
  userInput: string,
  reply: string,
  analysis: TutorAnalysis | null,
  id: string = crypto.randomUUID(),
  opts: { excludeFromContext?: boolean; displayText?: string } = {},
): Promise<string> {
  await db.insert(turn).values({
    id,
    createdAt: Date.now(),
    userInput,
    reply,
    analysisJson: analysis ? JSON.stringify(analysis) : null,
    conversationId,
    excludeFromContext: opts.excludeFromContext ? 1 : 0,
    displayText: opts.displayText ?? null,
  });
  return id;
}

// Overwrite the AI reply for a turn (used by "regenerate"). The correction is left unchanged — only the AI sentence is replaced.
export async function updateTurnReply(
  id: string,
  reply: string,
): Promise<void> {
  await db.update(turn).set({ reply }).where(eq(turn.id, id));
}

export async function updateTurnAnalysis(
  id: string,
  analysis: TutorAnalysis | null,
  prose?: string | null,
  diagnostic?: string | null,
): Promise<void> {
  await db
    .update(turn)
    .set({ analysisJson: serializeTurnFeedback(analysis, prose, diagnostic) })
    .where(eq(turn.id, id));
}

const PROSE_FEEDBACK_MARKER = "__prose_feedback";

export interface ChatTurn {
  id: string;
  userText: string;
  partnerText?: string;
  analysis: TutorAnalysis | null;
  analysisProse?: string | null;
  analysisPending?: boolean;
  analysisError?: string | null;
  /** /btw off-record turn: still shown in history, answered standalone, excluded from future context and not corrected. */
  excludeFromContext?: boolean;
  /** Prompt-macro turn (/topic, /learn, /surprise): verbatim command text to render in the bubble instead of userText. */
  displayText?: string;
}

export function serializeTurnFeedback(
  analysis: TutorAnalysis | null,
  prose?: string | null,
  diagnostic?: string | null,
): string | null {
  if (analysis) return JSON.stringify(analysis);
  if (prose?.trim()) {
    return JSON.stringify({
      [PROSE_FEEDBACK_MARKER]: true,
      body: prose.trim(),
      diagnostic: diagnostic?.trim() || undefined,
    });
  }
  return null;
}

function parseStructuredAnalysisJson(json: string): TutorAnalysis | null {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (v[PROSE_FEEDBACK_MARKER] === true) return null;
    return v as TutorAnalysis;
  } catch {
    return null;
  }
}

export function parseTurnFeedback(json: string | null): {
  analysis: TutorAnalysis | null;
  prose: string | null;
  diagnostic: string | null;
} {
  if (!json) return { analysis: null, prose: null, diagnostic: null };
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (v[PROSE_FEEDBACK_MARKER] === true && typeof v.body === "string") {
      return {
        analysis: null,
        prose: v.body,
        diagnostic: typeof v.diagnostic === "string" ? v.diagnostic : null,
      };
    }
    return {
      analysis: parseStructuredAnalysisJson(json),
      prose: null,
      diagnostic: null,
    };
  } catch {
    return { analysis: null, prose: null, diagnostic: null };
  }
}

// Restore chat history for a conversation from the DB (chronological order), loaded when ChatView mounts.
export async function loadChatHistory(
  conversationId: string,
  limit = 200,
): Promise<ChatTurn[]> {
  const turns = await getRecentTurnsForConversation(conversationId, limit);
  return turns.map((t) => {
    const { analysis, prose, diagnostic } = parseTurnFeedback(t.analysisJson);
    return {
      id: t.id,
      userText: t.userInput,
      partnerText: t.reply,
      analysis,
      analysisProse: prose,
      analysisError: diagnostic,
      excludeFromContext: t.excludeFromContext === 1,
      displayText: t.displayText ?? undefined,
    };
  });
}

export function parseTurnAnalysis(json: string | null): TutorAnalysis | null {
  return parseTurnFeedback(json).analysis;
}

// Global most-recent turns (cross-conversation). Used by the maintainer agent's getRecentlyIntroduced — intentionally not scoped per conversation.
export async function getRecentTurns(limit = 6): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse(); // chronological order — more natural to feed into prompts
}

export async function getTurnsSince(
  sinceMs: number,
  limit = 24,
): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .where(gt(turn.createdAt, sinceMs))
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function getTurn(id: string): Promise<Turn | null> {
  const [row] = await db.select().from(turn).where(eq(turn.id, id)).limit(1);
  return row ?? null;
}

// Most-recent turns within a conversation. The conversation/tutor agent context is scoped per conversation so topics do not bleed across.
export async function getRecentTurnsForConversation(
  conversationId: string,
  limit = 6,
): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .where(eq(turn.conversationId, conversationId))
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse(); // chronological order — more natural to feed into prompts
}

// The "user line" for a turn in history: for native-language/mixed-language turns (those with an expression_gap),
// use the tutor's idiomatic target-language translation so the conversation continues coherently in the target language; otherwise use the raw input.
function userLineForHistory(t: Turn): string {
  const { analysis } = parseTurnFeedback(t.analysisJson);
  const target = analysis?.expression_gap?.target_expression?.trim();
  return target || t.userInput;
}

// Format a set of turns (passed in chronological order) into history text usable by both the conversation and tutor agents.
export function formatTurns(turns: Turn[]): string {
  return turns
    .map((t) => {
      const user = userLineForHistory(t).trim();
      return user
        ? `User: ${user}\nPartner: ${t.reply}`
        : `Partner: ${t.reply}`;
    })
    .join("\n\n");
}

// Structured history for the reply agents: the conversation/lesson partner sees
// real alternating user/assistant turns (see buildHistoryMessages) instead of the
// flattened transcript above, so it doesn't lose track of whose turn it is.
export function toHistoryTurns(turns: Turn[]): HistoryTurn[] {
  return turns.map((t) => ({
    user: userLineForHistory(t).trim(),
    reply: t.reply,
  }));
}

// Fetch all verbatim turns after the "watermark" for a conversation (chronological order). afterId = summary_through_id:
// the last turn folded into the summary. null = not yet compressed, returns all. The auto-compressing conversation agent
// assembles context from "summary + these verbatim turns" (see orchestrator / summary-runner).
export async function getTurnsAfterId(
  conversationId: string,
  afterId: string | null,
): Promise<Turn[]> {
  // Off-record turns (/btw) are never included in context: filtered out uniformly at the SQL level here.
  const all = () =>
    db
      .select()
      .from(turn)
      .where(
        and(
          eq(turn.conversationId, conversationId),
          eq(turn.excludeFromContext, 0),
        ),
      )
      .orderBy(turn.createdAt);
  if (!afterId) return all();

  const [mark] = await db
    .select({ createdAt: turn.createdAt })
    .from(turn)
    .where(eq(turn.id, afterId))
    .limit(1);
  if (!mark) return all(); // The watermark turn no longer exists → fall back to all, safe.

  // Use createdAt >= watermark then exclude the watermark turn itself by id: no gaps (concurrent same-millisecond turns are kept) and no duplicate of the watermark turn.
  const rows = await db
    .select()
    .from(turn)
    .where(
      and(
        eq(turn.conversationId, conversationId),
        eq(turn.excludeFromContext, 0),
        gte(turn.createdAt, mark.createdAt),
      ),
    )
    .orderBy(turn.createdAt);
  return rows.filter((t) => t.id !== afterId);
}

// Incremental transcript for the maintainer agent: only fetch turns created after the last maintenance run (createdAt > sinceMs),
// to avoid re-digesting old content (repeated rewrites of "About me" cause slow drift). Not scoped per conversation (profile is global).
// Then truncate from the most recent turn down to the character budget, a rough proxy for the token budget, to prevent long turns from blowing up the context.
export async function formatHistorySince(
  sinceMs: number,
  charBudget: number,
  maxTurns = 100,
): Promise<string> {
  const rows = await db
    .select()
    .from(turn)
    .where(and(gt(turn.createdAt, sinceMs), eq(turn.excludeFromContext, 0)))
    .orderBy(desc(turn.createdAt))
    .limit(maxTurns);
  const lines: string[] = [];
  let used = 0;
  for (const t of rows) {
    const line = `User: ${t.userInput}\nPartner: ${t.reply}`;
    if (used + line.length > charBudget && lines.length > 0) break;
    lines.push(line);
    used += line.length;
  }
  return lines.reverse().join("\n\n"); // chronological order — more natural to feed into prompts
}

// Comprehension signal: incremented by 1 when the user taps "explain" / "bilingual reading" on a reply
// (only user-initiated actions; auto-expanded bilingual does not count). Atomic increment, best-effort — one missed count does not affect the main flow.
export async function incrementExplainCount(id: string): Promise<void> {
  await db
    .update(turn)
    .set({ explainCount: sql`${turn.explainCount} + 1` })
    .where(eq(turn.id, id));
}

export async function incrementBilingualCount(id: string): Promise<void> {
  await db
    .update(turn)
    .set({ bilingualCount: sql`${turn.bilingualCount} + 1` })
    .where(eq(turn.id, id));
}

export async function getTurnCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(turn);
  return row?.n ?? 0;
}

// Extract "introduced" items from recent turns' analyses, deduplicated (used as "recently learned" for the maintainer agent).
export async function getRecentlyIntroduced(
  limit = 12,
): Promise<{ key: string; label: string }[]> {
  const turns = await getRecentTurns(limit);
  const seen = new Map<string, string>();
  for (const t of turns) {
    const { analysis: a } = parseTurnFeedback(t.analysisJson);
    if (!a) continue;
    for (const u of a.mastery_updates) {
      if (u.signal === "introduced") seen.set(normalizeKey(u.key), u.label);
    }
    for (const item of a.expression_gap?.key_items ?? []) {
      seen.set(normalizeKey(item.mastery_key), item.mastery_label);
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}
