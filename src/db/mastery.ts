import { asc, desc, eq, ne, sql } from "drizzle-orm";
import type { TutorAnalysis } from "../agents/schema";
import type { WeakItem } from "../agents/tutor";
import { db } from "./client";
import {
  applySignal,
  deriveSignals,
  dueReviewScore,
  type MasteryStatus,
  type MasteryType,
  normalizeKey,
  retentionScore,
  type Signal,
  statusFromCounts,
} from "./mastery-logic";
import {
  type MasteryEvent as MasteryEventRow,
  type MasteryItem,
  masteryEvent,
  masteryItem,
} from "./schema";

function payloadJson(payload: unknown): string | null {
  if (payload == null) return null;
  return JSON.stringify(payload);
}

type MasteryEventSource = "tutor" | "review" | "manual";

async function insertMasteryEvent(
  sig: Signal,
  now: number,
  turnId?: string,
  source: MasteryEventSource = "tutor",
): Promise<void> {
  await db.insert(masteryEvent).values({
    id: crypto.randomUUID(),
    createdAt: now,
    turnId: turnId ?? null,
    key: sig.key,
    label: sig.label,
    type: sig.type,
    kind: sig.kind,
    source,
    evidence: sig.example ?? null,
    note: sig.note ?? null,
    payloadJson: payloadJson(sig.payload),
  });
}

// Upsert by mastery_key and run applySignal. Counts/status are entirely managed by code.
async function upsertSignal(sig: Signal, now: number): Promise<void> {
  const [existing] = await db
    .select()
    .from(masteryItem)
    .where(eq(masteryItem.key, sig.key))
    .limit(1);

  if (existing) {
    const next = applySignal(
      { seenCount: existing.seenCount, errorCount: existing.errorCount },
      sig.kind,
      now,
    );
    await db
      .update(masteryItem)
      .set({
        label: sig.label,
        seenCount: next.seenCount,
        errorCount: next.errorCount,
        status: next.status,
        lastSeenAt: now,
        example: sig.example ?? existing.example,
        // notes is a user-editable field (especially the idiomatic phrasing for expression gaps).
        // Once it has content, don't overwrite it with a new signal — that would erase the user's manual edits; only fill it when empty.
        notes: existing.notes?.trim()
          ? existing.notes
          : (sig.note ?? existing.notes),
      })
      .where(eq(masteryItem.key, sig.key));
  } else {
    const fresh = applySignal({ seenCount: 0, errorCount: 0 }, sig.kind, now);
    await db.insert(masteryItem).values({
      id: crypto.randomUUID(),
      type: sig.type,
      key: sig.key,
      label: sig.label,
      status: fresh.status,
      seenCount: fresh.seenCount,
      errorCount: fresh.errorCount,
      lastSeenAt: now,
      example: sig.example ?? null,
      notes: sig.note ?? null,
    });
  }
}

// One turn of bookkeeping: derive signals → upsert one by one + persist events. A second occurrence of the same key is an update, not an insert.
async function recordAnalysisInner(
  analysis: TutorAnalysis,
  turnId?: string,
): Promise<void> {
  const now = Date.now();
  await recordSignalsInner(deriveSignals(analysis), turnId, "tutor", now);
}

async function recordSignalsInner(
  signals: Signal[],
  turnId: string | undefined,
  source: MasteryEventSource,
  now: number = Date.now(),
): Promise<void> {
  for (const sig of signals) {
    await upsertSignal(sig, now);
    await insertMasteryEvent(sig, now, turnId, source);
  }
}

// Serialization: correction runs fire-and-forget in the background (see orchestrator), multiple turns can run concurrently;
// but upsert is "read count → modify → write" — concurrent access loses increments (later write overwrites earlier write).
// Code is the ground truth for counts, must be deterministic — chain all bookkeeping onto a single promise chain, execute one turn at a time.
let recordQueue: Promise<unknown> = Promise.resolve();

export function recordAnalysis(
  analysis: TutorAnalysis,
  turnId?: string,
): Promise<void> {
  const next = recordQueue.then(() => recordAnalysisInner(analysis, turnId));
  // The chain must not break due to one turn throwing (otherwise subsequent bookkeeping is stuck forever); caller still receives the real result.
  recordQueue = next.catch(() => {});
  return next;
}

export function recordSignals(
  signals: Signal[],
  turnId?: string,
  source: MasteryEventSource = "review",
): Promise<void> {
  const normalized = signals.map((sig) => ({
    ...sig,
    key: normalizeKey(sig.key),
  }));
  const next = recordQueue.then(() =>
    recordSignalsInner(normalized, turnId, source),
  );
  recordQueue = next.catch(() => {});
  return next;
}

// Weak-items table for the tutor agent: prioritize struggling, high error rate, recently seen. See architecture.md#select-top-n.
export async function getWeakList(limit = 15): Promise<WeakItem[]> {
  const rows = await db
    .select({
      key: masteryItem.key,
      label: masteryItem.label,
      type: masteryItem.type,
      status: masteryItem.status,
      example: masteryItem.example,
      notes: masteryItem.notes,
    })
    .from(masteryItem)
    .where(ne(masteryItem.status, "known"))
    .orderBy(
      // +2 denominator shrinkage: pushes sparse items down so that "1/1 error = 100%" noise
      // doesn't outrank a genuinely recurring problem like 6/9 (6/11≈0.55 > 1/3≈0.33).
      sql`(${masteryItem.errorCount} * 1.0 / (${masteryItem.seenCount} + 2)) DESC`,
      desc(masteryItem.lastSeenAt),
    )
    .limit(limit);
  return rows;
}

export interface MasteryKeyHint {
  key: string;
  label: string;
  type: string;
  status: string;
}

export async function getMasteryKeyHints(
  limit = 40,
): Promise<MasteryKeyHint[]> {
  return db
    .select({
      key: masteryItem.key,
      label: masteryItem.label,
      type: masteryItem.type,
      status: masteryItem.status,
    })
    .from(masteryItem)
    .orderBy(desc(masteryItem.lastSeenAt))
    .limit(limit);
}

export async function getAllMastery(): Promise<MasteryItem[]> {
  return db.select().from(masteryItem).orderBy(desc(masteryItem.lastSeenAt));
}

// Evidence timeline for one learning item: every recorded observation (error /
// correct / introduced / gap) behind the current counters, newest first. This is
// what makes the snapshot auditable — the data page shows it when a row expands.
export async function listMasteryEvents(
  key: string,
  limit = 50,
): Promise<MasteryEventRow[]> {
  return db
    .select()
    .from(masteryEvent)
    .where(eq(masteryEvent.key, normalizeKey(key)))
    .orderBy(desc(masteryEvent.createdAt))
    .limit(limit);
}

export async function updateMasteryItem(
  key: string,
  patch: { label?: string; notes?: string | null; example?: string | null },
): Promise<void> {
  const updates: Partial<typeof masteryItem.$inferInsert> = {};
  if (patch.label !== undefined) updates.label = patch.label.trim();
  if (patch.notes !== undefined)
    updates.notes = patch.notes?.trim() ? patch.notes.trim() : null;
  if (patch.example !== undefined)
    updates.example = patch.example?.trim() ? patch.example.trim() : null;

  if (Object.keys(updates).length === 0) return;
  await db.update(masteryItem).set(updates).where(eq(masteryItem.key, key));
}

export async function createManualMasteryItem(input: {
  key: string;
  label: string;
  type: MasteryType;
  status?: MasteryStatus;
  example?: string | null;
  notes?: string | null;
}): Promise<void> {
  const now = Date.now();
  const key = normalizeKey(input.key);
  const status = input.status ?? "learning";
  const [existing] = await db
    .select({ key: masteryItem.key })
    .from(masteryItem)
    .where(eq(masteryItem.key, key))
    .limit(1);

  if (existing) {
    await updateMasteryItem(key, {
      label: input.label,
      example: input.example,
      notes: input.notes,
    });
    await setMasteryStatus(key, status);
    return;
  }

  await db.insert(masteryItem).values({
    id: crypto.randomUUID(),
    type: input.type,
    key,
    label: input.label.trim(),
    status,
    seenCount: status === "known" ? 3 : status === "struggling" ? 1 : 0,
    errorCount: status === "struggling" ? 1 : 0,
    lastSeenAt: now,
    example: input.example?.trim() || null,
    notes: input.notes?.trim() || null,
  });

  await insertMasteryEvent(
    {
      key,
      label: input.label.trim(),
      type: input.type,
      kind: status === "known" ? "correct" : "introduced",
      example: "Created by natural-language data edit",
      payload: { manual_action: "create_mastery_item" },
    },
    now,
    undefined,
    "manual",
  );
}

export async function setMasteryStatus(
  key: string,
  status: MasteryStatus,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(masteryItem)
    .where(eq(masteryItem.key, key))
    .limit(1);
  if (!existing) return;

  await db
    .update(masteryItem)
    .set({ status, lastSeenAt: Date.now() })
    .where(eq(masteryItem.key, key));

  await insertMasteryEvent(
    {
      key: existing.key,
      label: existing.label,
      type: existing.type,
      kind: status === "known" ? "correct" : "introduced",
      example: `Status set to ${status} by user`,
      payload: { manual_action: "set_status", status },
    },
    Date.now(),
    undefined,
    "manual",
  );
}

export async function deleteMasteryItem(key: string): Promise<void> {
  await db.delete(masteryItem).where(eq(masteryItem.key, key));
}

export async function mergeMasteryItems(
  sourceKeyRaw: string,
  targetKeyRaw: string,
): Promise<void> {
  const sourceKey = normalizeKey(sourceKeyRaw);
  const targetKey = normalizeKey(targetKeyRaw);
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;

  const [source, target] = await Promise.all([
    db
      .select()
      .from(masteryItem)
      .where(eq(masteryItem.key, sourceKey))
      .limit(1),
    db
      .select()
      .from(masteryItem)
      .where(eq(masteryItem.key, targetKey))
      .limit(1),
  ]);
  const from = source[0];
  const to = target[0];
  if (!from || !to) return;

  const seenCount = to.seenCount + from.seenCount;
  const errorCount = to.errorCount + from.errorCount;
  const now = Date.now();
  await db
    .update(masteryItem)
    .set({
      seenCount,
      errorCount,
      status: statusFromCounts(seenCount, errorCount),
      lastSeenAt: Math.max(to.lastSeenAt, from.lastSeenAt, now),
      example: to.example ?? from.example,
      notes: to.notes?.trim() ? to.notes : from.notes,
    })
    .where(eq(masteryItem.key, targetKey));

  await db
    .update(masteryEvent)
    .set({ key: targetKey, label: to.label, type: to.type })
    .where(eq(masteryEvent.key, sourceKey));
  await db.delete(masteryItem).where(eq(masteryItem.key, sourceKey));
  await insertMasteryEvent(
    {
      key: targetKey,
      label: to.label,
      type: to.type,
      kind: "introduced",
      example: `Merged ${sourceKey} into ${targetKey}`,
      payload: { manual_action: "merge_mastery_items", sourceKey, targetKey },
    },
    now,
    undefined,
    "manual",
  );
}

export async function markMasteryKnown(key: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(masteryItem)
    .where(eq(masteryItem.key, key))
    .limit(1);
  if (!existing) return;

  const now = Date.now();
  const minSeen =
    existing.errorCount === 0 ? 3 : Math.floor(existing.errorCount / 0.149) + 1;
  await db
    .update(masteryItem)
    .set({
      seenCount: Math.max(existing.seenCount, minSeen),
      status: "known",
      lastSeenAt: now,
    })
    .where(eq(masteryItem.key, key));

  await insertMasteryEvent(
    {
      key: existing.key,
      label: existing.label,
      type: existing.type,
      kind: "correct",
      example: "Marked known by user",
      payload: { manual_action: "mark_known" },
    },
    now,
    undefined,
    "manual",
  );
}

// Review candidates (selected by code, naturally reused by the conversation agent). Complements the weak-items table:
// weak-items gives "recently and most frequently wrong"; this gives non-known items "learned/practiced but not reviewed longest" —
// best suited for interleaving one or two into casual conversation.
// This moves "review via passive reuse" from "hoping the maintainer agent writes it into prose" to a code-controlled, targeted selection (L1).
export interface ReviewItem {
  key: string;
  label: string;
  type: string;
  status: string;
  example: string | null;
  notes: string | null;
  retention: number;
  dueScore: number;
}

export async function getReviewDueList(limit = 5): Promise<ReviewItem[]> {
  const now = Date.now();
  const rows = await db
    .select({
      key: masteryItem.key,
      label: masteryItem.label,
      type: masteryItem.type,
      status: masteryItem.status,
      seenCount: masteryItem.seenCount,
      errorCount: masteryItem.errorCount,
      lastSeenAt: masteryItem.lastSeenAt,
      example: masteryItem.example,
      notes: masteryItem.notes,
    })
    .from(masteryItem)
    .where(ne(masteryItem.status, "known"))
    .orderBy(asc(masteryItem.lastSeenAt));

  return rows
    .map((row) => {
      const retentionInput = {
        seenCount: row.seenCount,
        errorCount: row.errorCount,
        status: row.status,
        lastSeenAt: row.lastSeenAt,
      };
      return {
        key: row.key,
        label: row.label,
        type: row.type,
        status: row.status,
        example: row.example,
        notes: row.notes,
        retention: retentionScore(retentionInput, now),
        dueScore: dueReviewScore(retentionInput, now),
      };
    })
    .sort(
      (a, b) =>
        b.dueScore - a.dueScore ||
        a.retention - b.retention ||
        (a.label > b.label ? 1 : -1),
    )
    .slice(0, limit);
}

export interface ComfortableItem {
  key: string;
  label: string;
  type: string;
  status: string;
  example: string | null;
  notes: string | null;
}

export async function getComfortableList(
  limit = 8,
): Promise<ComfortableItem[]> {
  return db
    .select({
      key: masteryItem.key,
      label: masteryItem.label,
      type: masteryItem.type,
      status: masteryItem.status,
      example: masteryItem.example,
      notes: masteryItem.notes,
    })
    .from(masteryItem)
    .where(eq(masteryItem.status, "known"))
    .orderBy(desc(masteryItem.seenCount), desc(masteryItem.lastSeenAt))
    .limit(limit);
}

// Aggregated input for the maintainer agent (queried by code and fed in; don't let the LLM compute it). See profile-maintainer-agent.md#input.
export interface MaintainerData {
  weak: {
    label: string;
    key: string;
    type: string;
    errorCount: number;
    seenCount: number;
    status: string;
    lastSeenAt: number;
    example: string | null;
    notes: string | null;
  }[];
  recentlyKnown: { label: string; key: string }[];
}

export async function getMaintainerData(): Promise<MaintainerData> {
  const weak = await db
    .select({
      label: masteryItem.label,
      key: masteryItem.key,
      type: masteryItem.type,
      errorCount: masteryItem.errorCount,
      seenCount: masteryItem.seenCount,
      status: masteryItem.status,
      lastSeenAt: masteryItem.lastSeenAt,
      example: masteryItem.example,
      notes: masteryItem.notes,
    })
    .from(masteryItem)
    .where(ne(masteryItem.status, "known"))
    .orderBy(
      // +2 denominator shrinkage: pushes sparse items down so that "1/1 error = 100%" noise
      // doesn't outrank a genuinely recurring problem like 6/9 (6/11≈0.55 > 1/3≈0.33).
      sql`(${masteryItem.errorCount} * 1.0 / (${masteryItem.seenCount} + 2)) DESC`,
      desc(masteryItem.lastSeenAt),
    )
    .limit(15);

  const recentlyKnown = await db
    .select({ label: masteryItem.label, key: masteryItem.key })
    .from(masteryItem)
    .where(eq(masteryItem.status, "known"))
    .orderBy(desc(masteryItem.lastSeenAt))
    .limit(10);

  return { weak, recentlyKnown };
}
