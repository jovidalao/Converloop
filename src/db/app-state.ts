import { eq } from "drizzle-orm";
import { db } from "./client";
import { appState } from "./schema";

// Internal continuity markers. Stored in SQLite rather than localStorage to ensure they travel with main data backups/migrations.
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

// Remove a marker (e.g. a per-conversation cache entry when the conversation is deleted).
export async function deleteAppState(key: string): Promise<void> {
  await db.delete(appState).where(eq(appState.key, key));
}

// List all keys with the given prefix (per-conversation cache families, backup export).
export async function listAppStateKeys(prefix: string): Promise<string[]> {
  const rows = await db.select({ key: appState.key }).from(appState);
  return rows.map((r) => r.key).filter((k) => k.startsWith(prefix));
}
