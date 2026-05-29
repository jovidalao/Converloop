import { eq } from "drizzle-orm";
import { db } from "./client";
import { masteryItem, type MasteryItem } from "./schema";

export type ProbeResult =
  | { ok: true; row: MasteryItem; note: string }
  | { ok: false; error: string };

// Task 1 技术探针:验证 Drizzle(sqlite-proxy)+ tauri-plugin-sql 能
// 跑 migration、upsert 一个 mastery_item 并读回,字段无误。
export async function runMasteryProbe(): Promise<ProbeResult> {
  const key = "grammar:article_usage";
  try {
    await db
      .insert(masteryItem)
      .values({
        id: crypto.randomUUID(),
        type: "grammar",
        key,
        label: "冠词 a/an/the 的用法",
        status: "learning",
        seenCount: 1,
        errorCount: 1,
        lastSeenAt: Date.now(),
        example: "I have a apple.",
      })
      .onConflictDoUpdate({
        target: masteryItem.key,
        set: { lastSeenAt: Date.now() },
      });

    const [row] = await db
      .select()
      .from(masteryItem)
      .where(eq(masteryItem.key, key))
      .limit(1);

    if (!row) return { ok: false, error: "读回为空:upsert 后查不到该 key" };
    if (row.key !== key) return { ok: false, error: `key 不符: ${row.key}` };
    if (row.label !== "冠词 a/an/the 的用法")
      return { ok: false, error: `label 不符(列序错位?): ${row.label}` };

    // 只有读回 + 列序/断言全通过才会执行这一步;notes 写入读回的值,
    // 让无 GUI 环境能直接用 sqlite3 查 notes 确认读路径也工作。
    await db
      .update(masteryItem)
      .set({ notes: `probe:read_ok seen=${row.seenCount} status=${row.status}` })
      .where(eq(masteryItem.key, key));

    return { ok: true, row, note: "upsert + 读回成功,字段无误" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
