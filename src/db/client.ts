import Database from "@tauri-apps/plugin-sql";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

// 单例:tauri-plugin-sql 的连接。Database.load 会触发 Rust 侧 migration。
let sqlitePromise: Promise<Database> | null = null;
function getSqlite(): Promise<Database> {
  if (!sqlitePromise) {
    // 路径相对 AppConfig 目录;与 Rust 侧 add_migrations 的连接串一致。
    sqlitePromise = Database.load("sqlite:lang-agent.db");
  }
  return sqlitePromise;
}

// Drizzle sqlite-proxy 桥接:webview 里没有 better-sqlite3,
// 所以把 Drizzle 生成的 SQL 交给 tauri-plugin-sql 执行。
//
// 契约(drizzle-orm/sqlite-proxy):回调返回 { rows }。
//   - run            → 写操作,返回 { rows: [] }
//   - all / values   → { rows: any[][] }(每行是按列顺序的值数组)
//   - get            → { rows: any[] }(单行值数组)
// tauri-plugin-sql 的 select 返回的是对象数组({列名: 值}),
// 列名顺序即 SELECT 顺序,故 Object.values 还原成 Drizzle 要的值数组。
export const db = drizzle(
  async (sql, params, method) => {
    const sqlite = await getSqlite();

    if (method === "run") {
      await sqlite.execute(sql, params);
      return { rows: [] };
    }

    const rows = await sqlite.select<Record<string, unknown>[]>(sql, params);
    const values = rows.map((row) => Object.values(row));
    return { rows: method === "get" ? (values[0] ?? []) : values };
  },
  { schema },
);
