import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 镜像 src-tauri 的 migration(create_mastery_item)。两边手动保持一致。
// 字段语义见 docs/architecture.md#sqlitemastery_item。
export const masteryItem = sqliteTable("mastery_item", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: [
      "vocab",
      "grammar",
      "collocation",
      "error_pattern",
      "expression_gap",
    ],
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

// 每条导师观察信号的事件日志。mastery_item 是可查询快照;event 是可追溯证据。
export const masteryEvent = sqliteTable("mastery_event", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  turnId: text("turn_id"),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type", {
    enum: [
      "vocab",
      "grammar",
      "collocation",
      "error_pattern",
      "expression_gap",
    ],
  }).notNull(),
  kind: text("kind", {
    enum: ["error", "correct", "introduced", "gap"],
  }).notNull(),
  source: text("source", {
    enum: ["tutor", "review", "manual"],
  }).notNull(),
  evidence: text("evidence"),
  note: text("note"),
  payloadJson: text("payload_json"),
});

export type MasteryEvent = typeof masteryEvent.$inferSelect;

// 会话(左侧对话列表)。镜像 src-tauri migration v3(create_conversation)。
export const conversation = sqliteTable("conversation", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Conversation = typeof conversation.$inferSelect;

// 每轮持久化:输入 / 回复 / 导师分析(JSON,导师失败时为 null)。
// conversation_id 由 migration v4 追加,旧数据为 NULL(启动时归档到默认会话)。
// explain/bilingual_count(v5/v6):用户在这条回复上请求讲解/双语的次数 = 理解吃力信号。
export const turn = sqliteTable("turn", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  userInput: text("user_input").notNull(),
  reply: text("reply").notNull(),
  analysisJson: text("analysis_json"),
  conversationId: text("conversation_id"),
  explainCount: integer("explain_count").notNull().default(0),
  bilingualCount: integer("bilingual_count").notNull().default(0),
});

export type Turn = typeof turn.$inferSelect;
