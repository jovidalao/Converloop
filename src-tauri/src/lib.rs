mod backup;
mod edge_tts;
mod llm;
mod oauth;
mod profile;
mod secrets;
mod stt;
mod stt_local;

use tauri_plugin_sql::{Migration, MigrationKind};

// Schema: see docs/design.md. Counts/state belong to code, not LLMs.
const CREATE_MASTERY_ITEM: &str = "\
CREATE TABLE IF NOT EXISTS mastery_item (
    id           TEXT PRIMARY KEY NOT NULL,
    type         TEXT NOT NULL,
    key          TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    status       TEXT NOT NULL,
    seen_count   INTEGER NOT NULL DEFAULT 0,
    error_count  INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL,
    example      TEXT,
    notes        TEXT
);";

// Per-turn persistence: input, reply, and tutor analysis JSON.
const CREATE_TURN: &str = "\
CREATE TABLE IF NOT EXISTS turn (
    id            TEXT PRIMARY KEY NOT NULL,
    created_at    INTEGER NOT NULL,
    user_input    TEXT NOT NULL,
    reply         TEXT NOT NULL,
    analysis_json TEXT
);";

// Conversations for the ChatGPT/Claude-style sidebar. Each turn belongs to one
// conversation; conversation/tutor agent history is isolated by conversation_id
// while mastery/maintenance remain global. Legacy turns have NULL conversation_id
// and are archived into the default conversation by TS ensureActiveConversation.
const CREATE_CONVERSATION: &str = "\
CREATE TABLE IF NOT EXISTS conversation (
    id         TEXT PRIMARY KEY NOT NULL,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);";

const ADD_TURN_CONVERSATION_ID: &str =
    "ALTER TABLE turn ADD COLUMN conversation_id TEXT;";

// Comprehension signals: how often the user clicks Explain / Bilingual Reading on
// a reply. High frequency means that input exceeded the current level. Code records
// it, LLMs do not. SQLite can only add one column per ALTER, so this is split.
const ADD_TURN_EXPLAIN_COUNT: &str =
    "ALTER TABLE turn ADD COLUMN explain_count INTEGER NOT NULL DEFAULT 0;";

const ADD_TURN_BILINGUAL_COUNT: &str =
    "ALTER TABLE turn ADD COLUMN bilingual_count INTEGER NOT NULL DEFAULT 0;";

// Event log for each tutor observation signal. mastery_item is the queryable
// snapshot; events are traceable evidence.
const CREATE_MASTERY_EVENT: &str = "\
CREATE TABLE IF NOT EXISTS mastery_event (
    id           TEXT PRIMARY KEY NOT NULL,
    created_at   INTEGER NOT NULL,
    turn_id      TEXT,
    key          TEXT NOT NULL,
    label        TEXT NOT NULL,
    type         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    source       TEXT NOT NULL,
    evidence     TEXT,
    note         TEXT,
    payload_json TEXT
);";

const CREATE_MASTERY_EVENT_KEY_INDEX: &str =
    "CREATE INDEX IF NOT EXISTS mastery_event_key_created_idx ON mastery_event (key, created_at);";

const CREATE_MASTERY_EVENT_TURN_INDEX: &str =
    "CREATE INDEX IF NOT EXISTS mastery_event_turn_idx ON mastery_event (turn_id);";

// Internal app continuity markers. Not user preferences, but they must migrate with backups.
const CREATE_APP_STATE: &str = "\
CREATE TABLE IF NOT EXISTS app_state (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);";

// Customized learning agents. Built-ins are stored in the DB too so users can
// fine-tune prompts; startup TS only fills missing rows and does not overwrite
// built-ins the user has edited.
const CREATE_LEARNING_AGENT: &str = "\
CREATE TABLE IF NOT EXISTS learning_agent (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    data_scope_json TEXT NOT NULL,
    built_in        INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);";

const ADD_CONVERSATION_KIND: &str =
    "ALTER TABLE conversation ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice';";

const ADD_CONVERSATION_LEARNING_AGENT_ID: &str =
    "ALTER TABLE conversation ADD COLUMN learning_agent_id TEXT;";

// Rolling summary (automatic compression): summary is the target-language recap of
// older content in this conversation, and summary_through_id is the last folded
// turn.id watermark. Code maintains the fields; the LLM only writes summary text.
// NULL means not compressed yet and falls back to raw history replay. SQLite can
// only add one column per ALTER, so this is split.
const ADD_CONVERSATION_SUMMARY: &str =
    "ALTER TABLE conversation ADD COLUMN summary TEXT;";

const ADD_CONVERSATION_SUMMARY_THROUGH_ID: &str =
    "ALTER TABLE conversation ADD COLUMN summary_through_id TEXT;";

const ADD_LEARNING_AGENT_VERSION: &str =
    "ALTER TABLE learning_agent ADD COLUMN version INTEGER NOT NULL DEFAULT 1;";

const ADD_LEARNING_AGENT_ALLOWED_TOOLS_JSON: &str =
    "ALTER TABLE learning_agent ADD COLUMN allowed_tools_json TEXT NOT NULL DEFAULT '[]';";

const ADD_LEARNING_AGENT_WRITEBACK_POLICY: &str =
    "ALTER TABLE learning_agent ADD COLUMN writeback_policy TEXT NOT NULL DEFAULT 'none';";

const ADD_LEARNING_AGENT_OUTPUT_SCHEMA_JSON: &str =
    "ALTER TABLE learning_agent ADD COLUMN output_schema_json TEXT;";

const ADD_LEARNING_AGENT_KIND: &str =
    "ALTER TABLE learning_agent ADD COLUMN kind TEXT NOT NULL DEFAULT 'lesson';";

const ADD_LEARNING_AGENT_HOOK: &str =
    "ALTER TABLE learning_agent ADD COLUMN hook TEXT;";

const ADD_LEARNING_AGENT_ENABLED: &str =
    "ALTER TABLE learning_agent ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;";

const ADD_LEARNING_AGENT_PACKAGE_META_JSON: &str =
    "ALTER TABLE learning_agent ADD COLUMN package_meta_json TEXT;";

// Prompt-macro turns (/topic, /learn, /surprise): bubbles show the user's original
// command text, while user_input stores the expanded English prompt sent to the
// conversation agent and included in later context. display_text is UI-only;
// normal turns keep it NULL and render user_input.
const ADD_TURN_DISPLAY_TEXT: &str = "ALTER TABLE turn ADD COLUMN display_text TEXT;";

// Conversation context loading (loadChatHistory / getTurnsAfterId) filters by
// conversation_id and sorts by time. Without an index, every load scans the whole
// turn table and slows the hot path once turns reach the thousands.
const CREATE_TURN_CONVERSATION_INDEX: &str =
    "CREATE INDEX IF NOT EXISTS turn_conversation_created_idx ON turn (conversation_id, created_at);";

// Sidebar pinning: pinned conversations stay first and do not sink by updated_at. 0 = unpinned.
const ADD_CONVERSATION_PINNED: &str =
    "ALTER TABLE conversation ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;";

// Learning project <-> lesson relation: lesson_agent_ids_json records generated
// lesson ids, and completed_lesson_ids_json records the ids the user marked done.
// Project progress is derived from both.
const ADD_LEARNING_PROJECT_LESSON_IDS: &str =
    "ALTER TABLE learning_project ADD COLUMN lesson_agent_ids_json TEXT NOT NULL DEFAULT '[]';";
const ADD_LEARNING_PROJECT_COMPLETED_LESSON_IDS: &str =
    "ALTER TABLE learning_project ADD COLUMN completed_lesson_ids_json TEXT NOT NULL DEFAULT '[]';";

// Clean up the legacy dictation aggregate item. Older builds recorded every
// dictation error under dictation:transcription, which only accumulated errors
// and never corrects, so it stayed at a permanent 100% error rate. mastery_event
// evidence is preserved; listening memory now uses isolated listening:<word> keys.
const DELETE_LEGACY_DICTATION_MASTERY: &str =
    "DELETE FROM mastery_item WHERE key LIKE 'dictation:%';";

// Drill mode rows live in learning_agent with kind="drill". source_md stores the
// drill@1 Markdown source of truth; name/description/prompt are parsed caches.
const ADD_LEARNING_AGENT_SOURCE_MD: &str =
    "ALTER TABLE learning_agent ADD COLUMN source_md TEXT;";

// kind="reply_transformer" rows: button icon, whether each reply auto-runs, and
// output destination (panel/replace/coach/memory).
const ADD_LEARNING_AGENT_ICON: &str =
    "ALTER TABLE learning_agent ADD COLUMN icon TEXT;";
const ADD_LEARNING_AGENT_AUTO_RUN: &str =
    "ALTER TABLE learning_agent ADD COLUMN auto_run INTEGER NOT NULL DEFAULT 0;";
const ADD_LEARNING_AGENT_OUTPUT_MODE: &str =
    "ALTER TABLE learning_agent ADD COLUMN output_mode TEXT;";

// kind="reply_transformer" rows: intervention stage (ai_reply button vs
// user_message button). NULL is treated as ai_reply.
const ADD_LEARNING_AGENT_TRANSFORMER_STAGE: &str =
    "ALTER TABLE learning_agent ADD COLUMN transformer_stage TEXT;";

const CREATE_AGENT_JOB: &str = "\
CREATE TABLE IF NOT EXISTS agent_job (
    id          TEXT PRIMARY KEY NOT NULL,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    input_json  TEXT,
    output_json TEXT,
    error       TEXT,
    source      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    started_at  INTEGER,
    finished_at INTEGER
);";

const ADD_AGENT_JOB_TURN_ID: &str =
    "ALTER TABLE agent_job ADD COLUMN turn_id TEXT;";

const ADD_CONVERSATION_PARENT_ID: &str =
    "ALTER TABLE conversation ADD COLUMN parent_conversation_id TEXT;";
const ADD_CONVERSATION_BRANCH_SOURCE_TURN_ID: &str =
    "ALTER TABLE conversation ADD COLUMN branch_source_turn_id TEXT;";
const ADD_CONVERSATION_BRANCH_KIND: &str =
    "ALTER TABLE conversation ADD COLUMN branch_kind TEXT;";
const ADD_CONVERSATION_AGENT_MODIFIERS_JSON: &str =
    "ALTER TABLE conversation ADD COLUMN agent_modifiers_json TEXT;";

const CREATE_LEARNING_PROJECT: &str = "\
CREATE TABLE IF NOT EXISTS learning_project (
    id             TEXT PRIMARY KEY NOT NULL,
    title          TEXT NOT NULL,
    goal           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    plan_md        TEXT NOT NULL DEFAULT '',
    notes_md       TEXT NOT NULL DEFAULT '',
    source_prompt  TEXT,
    task_plan_json TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);";

const CREATE_TURN_ANNOTATION: &str = "\
CREATE TABLE IF NOT EXISTS turn_annotation (
    id           TEXT PRIMARY KEY NOT NULL,
    turn_id      TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    title        TEXT NOT NULL,
    body_md      TEXT NOT NULL,
    payload_json TEXT,
    created_at   INTEGER NOT NULL
);";

const CREATE_MEMORY_PROPOSAL: &str = "\
CREATE TABLE IF NOT EXISTS memory_proposal (
    id              TEXT PRIMARY KEY NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    status          TEXT NOT NULL,
    agent_id        TEXT NOT NULL,
    turn_id         TEXT,
    summary         TEXT NOT NULL,
    operations_json TEXT NOT NULL,
    result_json     TEXT
);";

// Off-profile /btw turns: still persisted and shown in history, but skipped when
// building context and not fed to the maintainer agent. Code records this; LLMs do
// not. Legacy rows default to 0, meaning normal inclusion.
const ADD_TURN_EXCLUDE_FROM_CONTEXT: &str =
    "ALTER TABLE turn ADD COLUMN exclude_from_context INTEGER NOT NULL DEFAULT 0;";

/// Apply native vibrancy to the whole window using the Sidebar material. The
/// window is transparent, while the frontend only lets the sidebar/titlebar/coach
/// chrome show through; the main chat remains opaque for text readability. That
/// matches Mail/Notes/Finder-style translucent sidebars. state=None follows the
/// active window state, and the material follows setTheme appearance changes.
#[cfg(target_os = "macos")]
fn apply_window_vibrancy(win: &tauri::WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    let _ = apply_vibrancy(win, NSVisualEffectMaterial::Sidebar, None, None);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_mastery_item",
            sql: CREATE_MASTERY_ITEM,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_turn",
            sql: CREATE_TURN,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_conversation",
            sql: CREATE_CONVERSATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_turn_conversation_id",
            sql: ADD_TURN_CONVERSATION_ID,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_turn_explain_count",
            sql: ADD_TURN_EXPLAIN_COUNT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_turn_bilingual_count",
            sql: ADD_TURN_BILINGUAL_COUNT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "create_mastery_event",
            sql: CREATE_MASTERY_EVENT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "create_mastery_event_key_index",
            sql: CREATE_MASTERY_EVENT_KEY_INDEX,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "create_mastery_event_turn_index",
            sql: CREATE_MASTERY_EVENT_TURN_INDEX,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "create_app_state",
            sql: CREATE_APP_STATE,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "create_learning_agent",
            sql: CREATE_LEARNING_AGENT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_conversation_kind",
            sql: ADD_CONVERSATION_KIND,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_conversation_learning_agent_id",
            sql: ADD_CONVERSATION_LEARNING_AGENT_ID,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add_conversation_summary",
            sql: ADD_CONVERSATION_SUMMARY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add_conversation_summary_through_id",
            sql: ADD_CONVERSATION_SUMMARY_THROUGH_ID,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_learning_agent_version",
            sql: ADD_LEARNING_AGENT_VERSION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add_learning_agent_allowed_tools_json",
            sql: ADD_LEARNING_AGENT_ALLOWED_TOOLS_JSON,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add_learning_agent_writeback_policy",
            sql: ADD_LEARNING_AGENT_WRITEBACK_POLICY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add_learning_agent_output_schema_json",
            sql: ADD_LEARNING_AGENT_OUTPUT_SCHEMA_JSON,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "create_agent_job",
            sql: CREATE_AGENT_JOB,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "create_learning_project",
            sql: CREATE_LEARNING_PROJECT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "add_agent_job_turn_id",
            sql: ADD_AGENT_JOB_TURN_ID,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "add_conversation_parent_id",
            sql: ADD_CONVERSATION_PARENT_ID,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "add_conversation_branch_source_turn_id",
            sql: ADD_CONVERSATION_BRANCH_SOURCE_TURN_ID,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "add_conversation_branch_kind",
            sql: ADD_CONVERSATION_BRANCH_KIND,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "add_conversation_agent_modifiers_json",
            sql: ADD_CONVERSATION_AGENT_MODIFIERS_JSON,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "add_learning_agent_kind",
            sql: ADD_LEARNING_AGENT_KIND,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "add_learning_agent_hook",
            sql: ADD_LEARNING_AGENT_HOOK,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "add_learning_agent_enabled",
            sql: ADD_LEARNING_AGENT_ENABLED,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "create_turn_annotation",
            sql: CREATE_TURN_ANNOTATION,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "create_memory_proposal",
            sql: CREATE_MEMORY_PROPOSAL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "add_turn_exclude_from_context",
            sql: ADD_TURN_EXCLUDE_FROM_CONTEXT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "add_learning_agent_package_meta_json",
            sql: ADD_LEARNING_AGENT_PACKAGE_META_JSON,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "add_turn_display_text",
            sql: ADD_TURN_DISPLAY_TEXT,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 35,
            description: "create_turn_conversation_index",
            sql: CREATE_TURN_CONVERSATION_INDEX,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 36,
            description: "add_conversation_pinned",
            sql: ADD_CONVERSATION_PINNED,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 37,
            description: "add_learning_project_lesson_ids",
            sql: ADD_LEARNING_PROJECT_LESSON_IDS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 38,
            description: "add_learning_project_completed_lesson_ids",
            sql: ADD_LEARNING_PROJECT_COMPLETED_LESSON_IDS,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 39,
            description: "delete_legacy_dictation_mastery",
            sql: DELETE_LEGACY_DICTATION_MASTERY,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 40,
            description: "add_learning_agent_source_md",
            sql: ADD_LEARNING_AGENT_SOURCE_MD,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 41,
            description: "add_learning_agent_icon",
            sql: ADD_LEARNING_AGENT_ICON,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 42,
            description: "add_learning_agent_auto_run",
            sql: ADD_LEARNING_AGENT_AUTO_RUN,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 43,
            description: "add_learning_agent_output_mode",
            sql: ADD_LEARNING_AGENT_OUTPUT_MODE,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 44,
            description: "add_learning_agent_transformer_stage",
            sql: ADD_LEARNING_AGENT_TRANSFORMER_STAGE,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:lang-agent.db", migrations)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    apply_window_vibrancy(&win);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secrets::set_secret,
            secrets::get_secret,
            secrets::delete_secret,
            llm::llm_request,
            llm::llm_stream,
            edge_tts::edge_tts_synthesize,
            oauth::oauth_listen,
            oauth::oauth_token_post,
            profile::read_profile,
            profile::write_profile,
            profile::snapshot_profile,
            profile::restore_profile,
            backup::export_backup,
            stt::stt_transcribe,
            stt_local::local_asr_model_status,
            stt_local::local_asr_download_model,
            stt_local::stt_transcribe_local,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
