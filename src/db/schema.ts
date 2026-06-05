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
  kind: text("kind", {
    enum: ["practice", "learning_agent"],
  })
    .notNull()
    .default("practice"),
  learningAgentId: text("learning_agent_id"),
  // 滚动摘要(自动压缩):summary 是该会话老内容的目标语摘要;summaryThroughId 是已折叠
  // 进摘要的最后一个 turn.id(水位)。NULL = 尚未压缩,退化为纯原文回放。
  summary: text("summary"),
  summaryThroughId: text("summary_through_id"),
  // 会话分支(Agent-first Phase 3,migration v23–v26)。分支是非破坏式动作:从原会话派生
  // 出新会话,原会话不动。parentConversationId 指向来源会话;branchSourceTurnId 保留历史
  // 来源 turn 水位;branchKind 标记动作类型;agentModifiersJson 是回复 Agent 要遵循的
  // 会话级调节(难度 / 调换角色 / 第二天)。普通会话这几列全为 NULL。
  parentConversationId: text("parent_conversation_id"),
  branchSourceTurnId: text("branch_source_turn_id"),
  branchKind: text("branch_kind"),
  agentModifiersJson: text("agent_modifiers_json"),
});

export type Conversation = typeof conversation.$inferSelect;

// 定制化学习 Agent。内置 Agent 也存在这里,允许用户微调 prompt。
export const learningAgent = sqliteTable("learning_agent", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  dataScopeJson: text("data_scope_json").notNull(),
  kind: text("kind", {
    enum: ["lesson", "observer", "action"],
  })
    .notNull()
    .default("lesson"),
  hook: text("hook"),
  enabled: integer("enabled").notNull().default(1),
  version: integer("version").notNull().default(1),
  allowedToolsJson: text("allowed_tools_json").notNull().default("[]"),
  writebackPolicy: text("writeback_policy", {
    enum: ["none", "propose_review_signals"],
  })
    .notNull()
    .default("none"),
  outputSchemaJson: text("output_schema_json"),
  builtIn: integer("built_in").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type LearningAgent = typeof learningAgent.$inferSelect;
export type NewLearningAgent = typeof learningAgent.$inferInsert;

// 自定义 observer 的本轮可见产物。它不写 mastery;只把观察结果挂到某一轮,供 Coach Panel 展示。
export const turnAnnotation = sqliteTable("turn_annotation", {
  id: text("id").primaryKey(),
  turnId: text("turn_id").notNull(),
  agentId: text("agent_id").notNull(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  payloadJson: text("payload_json"),
  createdAt: integer("created_at").notNull(),
});

export type TurnAnnotation = typeof turnAnnotation.$inferSelect;
export type NewTurnAnnotation = typeof turnAnnotation.$inferInsert;

// Agent 提出的学习数据写入建议。确认前只排队;确认后代码验证并执行有限操作。
export const memoryProposal = sqliteTable("memory_proposal", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  status: text("status", {
    enum: ["pending", "applied", "dismissed"],
  }).notNull(),
  agentId: text("agent_id").notNull(),
  turnId: text("turn_id"),
  summary: text("summary").notNull(),
  operationsJson: text("operations_json").notNull(),
  resultJson: text("result_json"),
});

export type MemoryProposal = typeof memoryProposal.$inferSelect;
export type NewMemoryProposal = typeof memoryProposal.$inferInsert;

// 后台 / 异步 agent 作业日志。v1 只用于 Task Agent 规划学习项目,后续维护、
// 摘要、回写等也复用这张表做可追踪状态。
export const agentJob = sqliteTable("agent_job", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status", {
    enum: ["pending", "running", "succeeded", "failed"],
  }).notNull(),
  inputJson: text("input_json"),
  outputJson: text("output_json"),
  error: text("error"),
  source: text("source", {
    enum: ["task_agent", "maintainer", "summary", "manual", "conversation"],
  }).notNull(),
  // 热路径 Agent 运行日志关联的 turn(migration v22)。后台作业为 NULL。
  turnId: text("turn_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

export type AgentJob = typeof agentJob.$inferSelect;
export type NewAgentJob = typeof agentJob.$inferInsert;

// 学习项目是 Task Agent 的主要产物:一个可读计划 + 由代码创建的专项课草案。
export const learningProject = sqliteTable("learning_project", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  status: text("status", {
    enum: ["active", "completed", "archived"],
  })
    .notNull()
    .default("active"),
  planMd: text("plan_md").notNull().default(""),
  notesMd: text("notes_md").notNull().default(""),
  sourcePrompt: text("source_prompt"),
  taskPlanJson: text("task_plan_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type LearningProject = typeof learningProject.$inferSelect;
export type NewLearningProject = typeof learningProject.$inferInsert;

// 应用内部连续性标记。不是用户偏好,需要随数据库备份/迁移。
export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AppState = typeof appState.$inferSelect;

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
  // 离档轮次(/btw):1 = 仍显示在记录里,但构建上下文 / 喂维护 agent 时跳过(migration v32)。
  excludeFromContext: integer("exclude_from_context").notNull().default(0),
});

export type Turn = typeof turn.$inferSelect;
