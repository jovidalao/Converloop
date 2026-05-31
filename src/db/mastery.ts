import { asc, desc, eq, ne, sql } from "drizzle-orm";
import type { TutorAnalysis } from "../agents/schema";
import type { WeakItem } from "../agents/tutor";
import { db } from "./client";
import { applySignal, deriveSignals, type Signal } from "./mastery-logic";
import { type MasteryItem, masteryEvent, masteryItem } from "./schema";

function payloadJson(payload: unknown): string | null {
  if (payload == null) return null;
  return JSON.stringify(payload);
}

async function insertMasteryEvent(
  sig: Signal,
  now: number,
  turnId?: string,
  source: "tutor" | "review" | "manual" = "tutor",
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
        // notes 是用户可编辑字段(尤其表达缺口的地道说法)。一旦有内容就别用新信号
        // 覆盖,否则会清掉用户的手改;只在为空时填充。
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

// 一轮记账:派生信号 → 逐个 upsert + 事件落库。同一 key 第二次是 update,不新增。
async function recordAnalysisInner(
  analysis: TutorAnalysis,
  turnId?: string,
): Promise<void> {
  const now = Date.now();
  for (const sig of deriveSignals(analysis)) {
    await upsertSignal(sig, now);
    await insertMasteryEvent(sig, now, turnId);
  }
}

// 串行化:批改在后台 fire-and-forget 跑(见 orchestrator),多轮可并发;
// 而 upsert 是「读计数 → 改 → 写」,并发会丢增量(后写覆盖先写)。代码是计数的
// 地面真相,必须确定性 —— 把所有记账串到一条 promise 链上,逐轮顺序执行。
let recordQueue: Promise<unknown> = Promise.resolve();

export function recordAnalysis(
  analysis: TutorAnalysis,
  turnId?: string,
): Promise<void> {
  const next = recordQueue.then(() => recordAnalysisInner(analysis, turnId));
  // 链本身不能因某轮抛错而断(否则后续记账永远卡住);调用方仍拿到真实结果。
  recordQueue = next.catch(() => {});
  return next;
}

// 导师 agent 的薄弱表:优先 struggling、错得多、最近见过。见 architecture.md#选-top-n。
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
      // 分母 +2 收缩:把样本极少的项往下压,免得「错 1/1 = 100%」的噪音盖过
      // 真正反复出错的 6/9 老问题(6/11≈0.55 > 1/3≈0.33)。
      sql`(${masteryItem.errorCount} * 1.0 / (${masteryItem.seenCount} + 2)) DESC`,
      desc(masteryItem.lastSeenAt),
    )
    .limit(limit);
  return rows;
}

export async function getAllMastery(): Promise<MasteryItem[]> {
  return db.select().from(masteryItem).orderBy(desc(masteryItem.lastSeenAt));
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

export async function deleteMasteryItem(key: string): Promise<void> {
  await db.delete(masteryItem).where(eq(masteryItem.key, key));
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

// 复习候选(代码选,对话 agent 自然复用)。与薄弱表互补:薄弱表给「最近最常错」,
// 这里给「学过 / 练过但最久没重温」的非 known 项——最适合在闲聊里 interleave 一两个。
// 这把「复习靠被动复用」从「指望维护 agent 写进 prose」变成代码可控的定向选取(L1)。
export interface ReviewItem {
  label: string;
  type: string;
  example: string | null;
  notes: string | null;
}

export async function getReviewDueList(limit = 5): Promise<ReviewItem[]> {
  return db
    .select({
      label: masteryItem.label,
      type: masteryItem.type,
      example: masteryItem.example,
      notes: masteryItem.notes,
    })
    .from(masteryItem)
    .where(ne(masteryItem.status, "known"))
    .orderBy(asc(masteryItem.lastSeenAt)) // 最久没碰的优先
    .limit(limit);
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
      // 分母 +2 收缩:把样本极少的项往下压,免得「错 1/1 = 100%」的噪音盖过
      // 真正反复出错的 6/9 老问题(6/11≈0.55 > 1/3≈0.33)。
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
