mod backup;
mod edge_tts;
mod llm;
mod oauth;
mod profile;
mod secrets;
mod stt;
mod stt_local;

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

const ADD_LEARNING_AGENT_KIND: &str =
    "ALTER TABLE learning_agent ADD COLUMN kind TEXT NOT NULL DEFAULT 'lesson';";

const ADD_LEARNING_AGENT_HOOK: &str =
    "ALTER TABLE learning_agent ADD COLUMN hook TEXT;";

const ADD_LEARNING_AGENT_ENABLED: &str =
    "ALTER TABLE learning_agent ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;";

const ADD_LEARNING_AGENT_PACKAGE_META_JSON: &str =
    "ALTER TABLE learning_agent ADD COLUMN package_meta_json TEXT;";

// 提示词宏轮次(/topic、/learn、/surprise):气泡里显示用户原样输入的指令文本,
// 而 user_input 落库的是展开后的英文提示词(喂给对话 agent、并计入后续上下文)。
// display_text 仅供 UI 渲染气泡;普通轮次为 NULL(气泡照常显示 user_input)。
const ADD_TURN_DISPLAY_TEXT: &str = "ALTER TABLE turn ADD COLUMN display_text TEXT;";

// 会话上下文加载(loadChatHistory / getTurnsAfterId)按 conversation_id 过滤再按时间排序;
// 没有索引时每次都是全表扫,轮次累积到几千条后会拖慢每一轮的热路径。
const CREATE_TURN_CONVERSATION_INDEX: &str =
    "CREATE INDEX IF NOT EXISTS turn_conversation_created_idx ON turn (conversation_id, created_at);";

// 侧边栏置顶:置顶会话排在列表最前,不随 updated_at 下沉。0 = 未置顶。
const ADD_CONVERSATION_PINNED: &str =
    "ALTER TABLE conversation ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;";

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

// 离档轮次(/btw「顺便问一句」):仍落库、仍显示在记录里,但构建上下文时跳过它,
// 也不喂给维护 agent。代码记账,LLM 不碰。旧数据默认 0(=照常计入)。
const ADD_TURN_EXCLUDE_FROM_CONTEXT: &str =
    "ALTER TABLE turn ADD COLUMN exclude_from_context INTEGER NOT NULL DEFAULT 0;";

// 红绿灯沿用 macOS 原生按钮,位置参照 Codex 顶栏:左侧 21pt,垂直居中于 46pt chrome。
// 纯 AppKit 几何定位(不经 decorum):titlebar 容器撑到 chrome 高、顶边贴窗顶,
// 按钮放容器纵向正中——正中对称,与视图是否翻转无关,无需标定魔数。
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_X: f64 = 21.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_CHROME_H: f64 = 46.0;

#[cfg(target_os = "macos")]
fn apply_traffic_lights_inset(win: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;

    let Ok(raw) = win.ns_window() else { return };
    let ns_window: &NSWindow = unsafe { &*raw.cast() };

    let buttons: Vec<_> = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .filter_map(|kind| ns_window.standardWindowButton(kind))
    .collect();
    let [close, mini, ..] = buttons.as_slice() else {
        return;
    };

    // 相邻按钮间距:首次取系统原生值,此后保持我们设置的恒定差值。
    let delta = mini.frame().origin.x - close.frame().origin.x;
    let spacing = if delta > 0.0 { delta } else { 20.0 };

    // titlebar 容器(close.superview().superview())撑到 chrome 高、顶边贴窗顶
    // (NSWindow 坐标原点在左下,故 origin.y = 窗高 − chrome 高)。
    // SAFETY: superview 仅在主线程访问已存在的视图层级;Tauri 的窗口 API 在主线程调用本函数。
    if let Some(container) = unsafe { close.superview().and_then(|v| v.superview()) } {
        let mut rect = container.frame();
        rect.size.height = TRAFFIC_LIGHTS_CHROME_H;
        rect.origin.y = ns_window.frame().size.height - TRAFFIC_LIGHTS_CHROME_H;
        container.setFrame(rect);
    }

    for (i, button) in buttons.iter().enumerate() {
        let height = button.frame().size.height;
        button.setFrameOrigin(NSPoint {
            x: TRAFFIC_LIGHTS_X + i as f64 * spacing,
            y: (TRAFFIC_LIGHTS_CHROME_H - height) / 2.0,
        });
    }
}

/// 给整个窗口铺一层原生毛玻璃(Sidebar 材质)。窗口透明 + 前端只让侧栏/标题栏/教练栏
/// 透出(主对话区保持不透明、保证文字可读),于是只在这些 chrome 区域看到桌面/背后窗口的
/// 模糊——和 Mail/Notes/Finder 的半透明侧栏一致。state=None → 跟随窗口激活态自动明暗,
/// 这是 AppKit 的原生行为;材质会跟随 setTheme 设置的窗口外观切换明暗,无需手动重铺。
#[cfg(target_os = "macos")]
fn apply_window_vibrancy(win: &tauri::WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    let _ = apply_vibrancy(win, NSVisualEffectMaterial::Sidebar, None, None);
}

/// 重新钉一次交通灯位置。改动 NSWindow 外观(window.setTheme)会让 AppKit 把
/// 标准窗口按钮重排回默认位,而 inset 只在启动 + resize 时重定位;前端切换主题后
/// 调一次本命令把灯重新钉回居中。非 macOS 为空操作。
#[tauri::command]
fn reapply_traffic_lights(window: tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    apply_traffic_lights_inset(&window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// 把交通灯钉在自定义位置。关键是「绘制前」重定位:监听 AppKit 原生的
/// NSWindowDidResizeNotification(主线程、同步、绘制前派发),在回调里重设 inset。
/// 不用 Tauri 的 on_window_event(它在绘制后才触发,会看到灯先跳回默认位再跳回来)。
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
            edge_tts::edge_tts_synthesize,
            oauth::oauth_listen,
            oauth::oauth_token_post,
            profile::read_profile,
            profile::write_profile,
            profile::snapshot_profile,
            profile::restore_profile,
            backup::export_backup,
            stt::stt_transcribe,
            stt_local::parakeet_model_status,
            stt_local::parakeet_download_model,
            stt_local::stt_transcribe_parakeet,
            reapply_traffic_lights,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
