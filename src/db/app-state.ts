import { eq } from "drizzle-orm";
import { db } from "./client";
import { appState } from "./schema";

// 内部连续性标记。用 SQLite 而不是 localStorage,确保随主数据备份/迁移。
export async function getAppState(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appState.value })
    .from(appState)
    .where(eq(appState.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setAppState(key: string, value: string): Promise<void> {
  const now = Date.now();
  const [existing] = await db
    .select({ key: appState.key })
    .from(appState)
    .where(eq(appState.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(appState)
      .set({ value, updatedAt: now })
      .where(eq(appState.key, key));
    return;
  }

  await db.insert(appState).values({ key, value, updatedAt: now });
}
