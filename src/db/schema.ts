import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 镜像 src-tauri 的 migration(create_mastery_item)。两边手动保持一致。
// 字段语义见 docs/architecture.md#sqlitemastery_item。
export const masteryItem = sqliteTable("mastery_item", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: ["vocab", "grammar", "collocation", "error_pattern"],
  }).notNull(),
  key: text("key").notNull().unique(), // 稳定 upsert 键 = Issue.mastery_key
  label: text("label").notNull(),
  status: text("status", {
    enum: ["struggling", "learning", "known"],
  }).notNull(),
  seenCount: integer("seen_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastSeenAt: integer("last_seen_at").notNull(),
  example: text("example"),
  notes: text("notes"),
});

export type MasteryItem = typeof masteryItem.$inferSelect;
export type NewMasteryItem = typeof masteryItem.$inferInsert;
