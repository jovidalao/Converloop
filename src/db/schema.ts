import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  MASTERY_STATUS_VALUES,
  MASTERY_TYPE_VALUES,
  SIGNAL_KIND_VALUES,
} from "./mastery-values";

// Mirrors src-tauri's migration (create_mastery_item). Both sides kept in sync manually.
// Field semantics: see docs/architecture.md#sqlitemastery_item.
export const masteryItem = sqliteTable("mastery_item", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: MASTERY_TYPE_VALUES,
  }).notNull(),
  key: text("key").notNull().unique(), // stable upsert key = Issue.mastery_key
  label: text("label").notNull(),
  status: text("status", {
    enum: MASTERY_STATUS_VALUES,
  }).notNull(),
  seenCount: integer("seen_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastSeenAt: integer("last_seen_at").notNull(),
  example: text("example"),
  notes: text("notes"),
});

export type MasteryItem = typeof masteryItem.$inferSelect;
export type NewMasteryItem = typeof masteryItem.$inferInsert;

// Event log for each tutor observation signal. mastery_item is a queryable snapshot; event is traceable evidence.
export const masteryEvent = sqliteTable("mastery_event", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  turnId: text("turn_id"),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type", {
    enum: MASTERY_TYPE_VALUES,
  }).notNull(),
  kind: text("kind", {
    enum: SIGNAL_KIND_VALUES,
  }).notNull(),
  source: text("source", {
    enum: ["tutor", "review", "manual"],
  }).notNull(),
  evidence: text("evidence"),
  note: text("note"),
  payloadJson: text("payload_json"),
});

export type MasteryEvent = typeof masteryEvent.$inferSelect;

// Conversation (left-side conversation list). Mirrors src-tauri migration v3 (create_conversation).
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
  // Rolling summary (auto-compressed): summary is a target-language summary of older conversation content;
  // summaryThroughId is the last turn.id folded into the summary (watermark). NULL = not yet compressed, falls back to pure verbatim replay.
  summary: text("summary"),
  summaryThroughId: text("summary_through_id"),
  // Conversation branching (Agent-first Phase 3, migration v23–v26). Branching is a non-destructive action:
  // derives a new conversation from the source, source is untouched. parentConversationId points to the source;
  // branchSourceTurnId holds the historical source turn watermark; branchKind marks the action type;
  // agentModifiersJson is the session-level adjustments the reply agent should follow (difficulty / role swap / next day).
  // All these columns are NULL for normal conversations.
  parentConversationId: text("parent_conversation_id"),
  branchSourceTurnId: text("branch_source_turn_id"),
  branchKind: text("branch_kind"),
  agentModifiersJson: text("agent_modifiers_json"),
  // Sidebar pinning (migration v36): pinned conversations sort above the recency list. 0 = not pinned.
  pinned: integer("pinned").notNull().default(0),
});

export type Conversation = typeof conversation.$inferSelect;

// Customized learning agent. Built-in agents also live here, allowing users to fine-tune prompts.
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
  packageMetaJson: text("package_meta_json"),
  builtIn: integer("built_in").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type LearningAgent = typeof learningAgent.$inferSelect;
export type NewLearningAgent = typeof learningAgent.$inferInsert;

// Per-turn visible output from custom observers. Does not write mastery; only attaches observation results to a turn for display in the Coach Panel.
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

// Learning data write proposals raised by agents. Only queued until confirmed; after confirmation code validates and executes the limited operations.
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

// Agent jobs / run log. Background jobs use it to track lifecycle; hot-path and on-demand agents
// also write completed run records (source="conversation") for agent library auditing.
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
  // The turn associated with a hot-path agent run log entry (migration v22). NULL for background jobs.
  turnId: text("turn_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

export type AgentJob = typeof agentJob.$inferSelect;
export type NewAgentJob = typeof agentJob.$inferInsert;

// Learning projects are the main output of the Task Agent: a human-readable plan + a focused lesson draft created by code.
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
  // Lessons generated for this project (learning_agent ids) and the subset the user marked done (migration v37/v38).
  // Project progress ("2/3 lessons", next step) is derived from these two lists.
  lessonAgentIdsJson: text("lesson_agent_ids_json").notNull().default("[]"),
  completedLessonIdsJson: text("completed_lesson_ids_json")
    .notNull()
    .default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type LearningProject = typeof learningProject.$inferSelect;
export type NewLearningProject = typeof learningProject.$inferInsert;

// Internal application continuity markers. Not user preferences; must be backed up / migrated with the database.
export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type AppState = typeof appState.$inferSelect;

// Per-turn persistence: input / reply / tutor analysis (JSON, null when tutor fails).
// conversation_id added by migration v4; old data is NULL (archived to default conversation on startup).
// explain/bilingual_count (v5/v6): number of times the user requested explain/bilingual on this reply = comprehension difficulty signal.
export const turn = sqliteTable("turn", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  userInput: text("user_input").notNull(),
  reply: text("reply").notNull(),
  analysisJson: text("analysis_json"),
  conversationId: text("conversation_id"),
  explainCount: integer("explain_count").notNull().default(0),
  bilingualCount: integer("bilingual_count").notNull().default(0),
  // Off-record turns (/btw): 1 = still displayed in history, but skipped when building context / feeding the maintainer agent (migration v32).
  excludeFromContext: integer("exclude_from_context").notNull().default(0),
  // Prompt-macro turns (/topic, /learn, /surprise): the verbatim command text shown in the bubble; user_input holds the
  // expanded English prompt fed to the agent and kept in context. NULL for normal turns (the bubble shows user_input). Migration v34.
  displayText: text("display_text"),
});

export type Turn = typeof turn.$inferSelect;
