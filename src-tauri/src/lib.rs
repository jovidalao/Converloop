mod keychain;
mod llm;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_mastery_item",
        sql: CREATE_MASTERY_ITEM,
        kind: MigrationKind::Up,
    }];

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
