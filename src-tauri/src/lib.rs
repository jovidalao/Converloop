mod llm;
mod profile;
mod secrets;

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

// 理解信号:用户在某条回复上点「讲解」/「双语阅读」的次数。高频 = 这条输入超出当前
// 水平(代码记账、LLM 不碰)。SQLite 每条 ALTER 只能加一列,故拆成两个 migration。
const ADD_TURN_EXPLAIN_COUNT: &str =
    "ALTER TABLE turn ADD COLUMN explain_count INTEGER NOT NULL DEFAULT 0;";

const ADD_TURN_BILINGUAL_COUNT: &str =
    "ALTER TABLE turn ADD COLUMN bilingual_count INTEGER NOT NULL DEFAULT 0;";

// 每条导师观察信号的事件日志。mastery_item 是可查询快照;event 是可追溯证据。
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

// 应用内部连续性标记。不是用户偏好,需要随数据库备份/迁移。
const CREATE_APP_STATE: &str = "\
CREATE TABLE IF NOT EXISTS app_state (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);";

// 定制化学习 Agent。内置 Agent 也落库,这样用户可以微调 prompt;启动时 TS 侧只补缺,
// 不覆盖用户已经改过的内置 prompt。
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

// 滚动摘要(自动压缩):summary 是该会话「老内容」的目标语摘要,summary_through_id 是
// 已折叠进摘要的最后一个 turn.id(水位)。代码维护,LLM 只产出摘要文本。NULL = 尚未压缩,
// 退化为纯原文回放。SQLite 每条 ALTER 只能加一列,故拆成两个 migration。
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

// 红绿灯沿用 macOS 原生按钮,位置参照 Codex 顶栏:左侧 21pt,垂直居中于 46pt chrome。
// decorum 把按钮中心放在距窗顶 (button_h + y)/2 + 4 处;关闭按钮 button_h = 14,
// 解 (14 + y)/2 + 4 = 23 → y = 24。
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_X: f32 = 21.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_Y: f32 = 24.0;

#[cfg(target_os = "macos")]
fn apply_traffic_lights_inset(win: &tauri::WebviewWindow) {
    use tauri_plugin_decorum::WebviewWindowExt;
    let _ = win.set_traffic_lights_inset(TRAFFIC_LIGHTS_X, TRAFFIC_LIGHTS_Y);
}

/// 把交通灯钉在自定义位置。关键是「绘制前」重定位:监听 AppKit 原生的
/// NSWindowDidResizeNotification(主线程、同步、绘制前派发),在回调里重设 inset。
/// 不再用 Tauri 的 on_window_event(它在绘制后才触发,会看到灯先跳回默认位再跳回来),
/// 也不注册 decorum 插件(它内置的 resize delegate 会复位到默认位、和我们打架)。
#[cfg(target_os = "macos")]
fn setup_traffic_lights(win: tauri::WebviewWindow) {
    use block2::RcBlock;
    use core::ptr::NonNull;
    use objc2_app_kit::NSWindowDidResizeNotification;
    use objc2_foundation::{NSNotification, NSNotificationCenter};

    // 启动时定位一次。
    apply_traffic_lights_inset(&win);

    let win_cb = win.clone();
    let block = RcBlock::new(move |_n: NonNull<NSNotification>| {
        apply_traffic_lights_inset(&win_cb);
    });
    unsafe {
        let observer = NSNotificationCenter::defaultCenter()
            .addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidResizeNotification),
                None,
                None,
                &block,
            );
        // observer 要活到进程结束;单窗口应用,直接泄漏即可。
        core::mem::forget(observer);
    }
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
                    setup_traffic_lights(win);
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
            profile::read_profile,
            profile::write_profile,
            profile::snapshot_profile,
            profile::restore_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
