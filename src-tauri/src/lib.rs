mod keychain;
mod llm;
mod profile;

use tauri_plugin_sql::{Migration, MigrationKind};

// Schema 见 docs/architecture.md#sqlitemastery_item。计数/状态归代码管,LLM 不碰。
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

// 每轮持久化(输入 / 回复 / 导师分析 JSON)。
const CREATE_TURN: &str = "\
CREATE TABLE IF NOT EXISTS turn (
    id            TEXT PRIMARY KEY NOT NULL,
    created_at    INTEGER NOT NULL,
    user_input    TEXT NOT NULL,
    reply         TEXT NOT NULL,
    analysis_json TEXT
);";

// 会话(ChatGPT/Claude 式左侧对话列表)。每轮归属一个会话;对话/导师 agent 的历史
// 上下文按 conversation_id 隔离(掌握/维护仍全局)。旧 turn 的 conversation_id 为 NULL,
// 启动时由 TS 侧 ensureActiveConversation 归档到默认会话。
const CREATE_CONVERSATION: &str = "\
CREATE TABLE IF NOT EXISTS conversation (
    id         TEXT PRIMARY KEY NOT NULL,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);";

const ADD_TURN_CONVERSATION_ID: &str =
    "ALTER TABLE turn ADD COLUMN conversation_id TEXT;";

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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:lang-agent.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            keychain::set_secret,
            keychain::get_secret,
            keychain::delete_secret,
            llm::llm_request,
            llm::llm_stream,
            profile::read_profile,
            profile::write_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
