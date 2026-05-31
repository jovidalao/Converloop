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

// 红灯距白卡片左/上相等: x ≈ 0.55rem + 0.15rem + (2rem−12px)/2 → 21pt(16px 根字号下)。
// Y 让红绿灯垂直居中于顶栏(App.tsx 的 h-12 = 48px,标题/收展按钮居中在 24px)。
// decorum 把按钮中心放在距窗顶 (button_h + y)/2 + 4 处;关闭按钮 button_h = 14,
// 解 (14 + y)/2 + 4 = 24 → y = 26。
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_X: f32 = 21.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_Y: f32 = 26.0;

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
