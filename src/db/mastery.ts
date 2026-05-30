import { eq, ne, sql, desc } from "drizzle-orm";
import { db } from "./client";
import { masteryItem, type MasteryItem } from "./schema";
import {
  applySignal,
  deriveSignals,
  type Signal,
} from "./mastery-logic";
import type { TutorAnalysis } from "../agents/schema";
import type { WeakItem } from "../agents/tutor";

// 按 mastery_key upsert,并跑 applySignal。计数/状态全归代码。
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
        notes: sig.note ?? existing.notes,
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

// 一轮记账:派生信号 → 逐个 upsert。同一 key 第二次是 update,不新增。
export async function recordAnalysis(analysis: TutorAnalysis): Promise<void> {
  const now = Date.now();
  for (const sig of deriveSignals(analysis)) {
    await upsertSignal(sig, now);
  }
}

// 导师 agent 的薄弱表:优先 struggling、错得多、最近见过。见 architecture.md#选-top-n。
export async function getWeakList(limit = 15): Promise<WeakItem[]> {
  const rows = await db
    .select({
      key: masteryItem.key,
      label: masteryItem.label,
      type: masteryItem.type,
      status: masteryItem.status,
    })
    .from(masteryItem)
    .where(ne(masteryItem.status, "known"))
    .orderBy(
      sql`(${masteryItem.errorCount} * 1.0 / MAX(${masteryItem.seenCount}, 1)) DESC`,
      desc(masteryItem.lastSeenAt),
    )
    .limit(limit);
  return rows;
}

export async function getAllMastery(): Promise<MasteryItem[]> {
  return db.select().from(masteryItem).orderBy(desc(masteryItem.lastSeenAt));
}

// 维护 agent 的聚合输入(代码查好再喂,别让 LLM 自己算)。见 profile-maintainer-agent.md#输入。
export interface MaintainerData {
  weak: {
    label: string;
    key: string;
    type: string;
    errorCount: number;
    seenCount: number;
    status: string;
    lastSeenAt: number;
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
    })
    .from(masteryItem)
    .where(ne(masteryItem.status, "known"))
    .orderBy(
      sql`(${masteryItem.errorCount} * 1.0 / MAX(${masteryItem.seenCount}, 1)) DESC`,
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
