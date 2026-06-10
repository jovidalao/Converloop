import Database from "@tauri-apps/plugin-sql";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

// Singleton: tauri-plugin-sql connection. Database.load triggers the Rust-side migration.
let sqlitePromise: Promise<Database> | null = null;
function getSqlite(): Promise<Database> {
  if (!sqlitePromise) {
    // Path relative to the AppConfig directory; consistent with the connection string in Rust's add_migrations.
    sqlitePromise = Database.load("sqlite:lang-agent.db");
  }
  return sqlitePromise;
}

// Drizzle sqlite-proxy bridge: no better-sqlite3 in the webview,
// so Drizzle-generated SQL is handed to tauri-plugin-sql for execution.
//
// Contract (drizzle-orm/sqlite-proxy): callback returns { rows }.
//   - run            → write operation, returns { rows: [] }
//   - all / values   → { rows: any[][] }  (each row is a value array in column order)
//   - get            → { rows: any[] }    (single-row value array)
// tauri-plugin-sql's select returns an object array ({column: value}),
// column order matches SELECT order, so Object.values restores the value array Drizzle expects.
// SQLite is single-writer. Background correction bookkeeping (orchestrator's void analysisPromise)
// may concurrently write with the next turn's persistTurn, occasionally triggering SQLITE_BUSY.
// Chain all writes into a single promise chain, execute one at a time; reads are unaffected (still concurrent).
// Failures do not break the chain: catch is only for queuing; real results are thrown back to the caller via next.
let writeChain: Promise<unknown> = Promise.resolve();

export const db = drizzle(
  async (sql, params, method) => {
    const sqlite = await getSqlite();

    if (method === "run") {
      const next = writeChain.then(() => sqlite.execute(sql, params));
      writeChain = next.catch(() => {});
      await next;
      return { rows: [] };
    }

    // Caveat: a JOIN selecting two columns with the same name would collapse them in the
    // object form and break this positional reconstruction — alias such columns if ever needed.
    const rows = await sqlite.select<Record<string, unknown>[]>(sql, params);
    const values = rows.map((row) => Object.values(row));
    return { rows: method === "get" ? (values[0] ?? []) : values };
  },
  { schema },
);
