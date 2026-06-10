# Architecture (v1)

AI 语言学习 agent —— 第一版范围、数据流、存储与现状。Agent 的逐字契约见各自文档:[conversation](./conversation-agent.md) · [tutor](./tutor-agent.md) · [profile-maintainer](./profile-maintainer-agent.md) · [lessons](./lessons.md)(学习项目 + 专项课)· [reply-suggestion](./reply-suggestion-agent.md);母语/混说链路见 [expression-gap](./expression-gap.md)。

## v1 范围(刻意收窄)

> **Tauri 桌面端 + BYOK + 多 agent 流水线 + 本地 SQLite + LLM 维护的 MD 档案。**
> 没有云、没有同步、没有计费、没有 Web/手机、没有托管模型、没有抽认卡 SRS。

护城河是**学习质量**(纠错准不准、人设跟不跟得上),不是基础设施。**不假设本地 LLM**:现实默认是 BYOK 托管模型(OpenAI 兼容 / Anthropic / Gemini),本地模型是可选高级功能,不是设计约束。

## 架构铁律(改之前先理解为什么)

- **对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。**
- **LLM 只观察(给离散信号),代码负责记账(计数 / 置信度 / 状态)。** LLM 永不碰计数。
- `mastery_key` 跨句必须稳定(同一类错永远同一个 key)——这是掌握系统的地基。
- 热路径只有 2 个 agent(对话 ∥ 导师),并行;维护 agent 在后台批量跑。

## Agent 一览

| Agent | 何时跑 | 读什么 | 输出 | 文档 |
|---|---|---|---|---|
| **Conversation** | 每轮(热) | MD 叙述档案 + 对话 | 纯文本,流式 | [conversation-agent](./conversation-agent.md) |
| **Tutor** | 每轮(热,与对话并行) | SQLite 薄弱表 + 输入 | 结构化 `TutorAnalysis` | [tutor-agent](./tutor-agent.md) |
| **Profile Maintainer** | 偶尔(后台) | 现有 MD + SQLite 聚合 + 近期对话 | 更新后的 MD | [profile-maintainer-agent](./profile-maintainer-agent.md) |
| **Task / 学习项目** | 用户从定制化学习入口触发 | 用户目标 + 语言配置 | `learning_project` + 专项课草案 | [lessons](./lessons.md) |
| **Learning / 专项课** | 用户从定制化学习入口开启 | 代码拼好的学习数据 scope + 专项 prompt | 老师型课程回复,流式 | [lessons](./lessons.md) |
| **Explain**(按需) | 用户点「讲解」时 | 对话回复 + MD 档案切片 | 母语讲解,流式 | 见下方[按需讲解](#按需讲解-explain-agent) |
| **Reply Suggestion**(按需) | 用户点「推荐回复」时 | 被点击消息 + 会话上下文 + MD 档案切片 | 推荐用户可发送的目标语回复 | [reply-suggestion-agent](./reply-suggestion-agent.md) |

热路径只有对话 ∥ 导师两个 agent;维护、任务规划、讲解与推荐回复都不在热路径上(后台 / 按需)。代码侧的编排在 `src/orchestrator.ts`(`runTurn` = 对话 ∥ 导师 + 记账 + 持久化;`createLearningProjectFromGoal` = Task Agent 规划;`explainReply` = 按需讲解;`suggestReply` = 按需推荐回复)。

> **Agent Runtime:** 对话 / 专项课的主回复(reply_producer)与导师批改(observer)不再硬编码在 `runTurn` 里,而是经 `src/runtime` 的注册表派发(`dispatchReply` 按会话 kind 取唯一回复 Agent,`dispatchObservers` 遍历所有 observer 并行触发)。内置 Agent 在 `src/runtime/builtins.ts` 自注册;新增 observer 只需 `registerObserver`,不必改 `runTurn`。记账仍在代码侧(导师 observer 调 `recordAnalysis`,LLM 不碰计数)。每次运行经 `recordAgentRun` 落一条 `agent_job` 日志(`source="conversation"`,关联 `turn_id`)。

## 两层存储:各管一摊(核心决策)

| 层 | 存什么 | 谁维护 | 为什么 |
|---|---|---|---|
| **SQLite**(地面真相) | 掌握项快照 + 每条观察事件(error/correct/introduced/gap) | **代码**(每轮从信号派生) | 确定性、可排序查询、可重算、可画进度。LLM 不碰计数。 |
| **MD 档案**(叙述层) | 定性人设:在练什么、已掌握、回避、兴趣、最近学到、个人事实 | **维护 agent**(偶尔) | 人类可读可编、直接喂对话 agent。捕捉列存表达不了的定性状态。 |

**为什么不二选一:** 只用 MD → 丢掉可信计数、可排序、进度可视化(prose 是氛围不是数据,LLM 重写还会漂移)。只用 SQLite → 对话 agent 拿不到"这个人是谁"的定性人设。所以两层并存,各管一摊。

## 数据流

```
每轮(热路径,便宜、确定性):
  用户输入
    → 共享上下文(system 稳定段[缓存断点] + profile/weak-list + history + input)
    → Conversation Agent(读 MD 切片) ∥ Tutor Agent(读 SQLite 薄弱表)
    → 对话流式秒回给用户;批改稍后补到批改面板
    → 代码记账(deriveSignals → applySignal,见 tutor-agent):
        issues[]          → "error" 信号 → 写 SQLite
        expression_gap    → "gap" 信号(+ key_items 走 introduced)→ 写 mastery_event + mastery_item 快照
        mastery_updates[] → "correct" / "introduced" 信号 → 写 mastery_event + mastery_item 快照
    → 持久化本轮(turn:input / reply / analysis JSON,挂在当前 conversation 下)
    → 每 10 轮触发一次后台 Profile Maintainer(单飞)

按需:
  用户输入一个较大的学习目标 → Task Agent 生成学习项目 + 专项课草案
  用户点回复上的「讲解」→ Explain Agent 读该回复 + MD 切片 → 母语流式讲解
  用户点「朗读」      → TTS(见下)合成并播放

偶尔(每 10 轮 / 手动):
  Profile Maintainer 读 现有 MD + SQLite 聚合 + 近期对话
    → 产出更新后的 learner-profile.md(Rust 侧原子写入)
```

## SQLite schema

migration 定义在 **Rust 侧**(`src-tauri/src/lib.rs`,`tauri_plugin_sql::Builder::add_migrations`),`Database.load()` 时触发。Drizzle 只做类型安全查询,不接管 migration —— TS 侧 `src/db/schema.ts` **手动镜像** Rust 的建表,两边保持一致。

当前 36 个 migration:

| ver | 描述 | 表 / 变更 |
|---|---|---|
| 1 | create_mastery_item | `mastery_item` |
| 2 | create_turn | `turn` |
| 3 | create_conversation | `conversation` |
| 4 | add_turn_conversation_id | `turn.conversation_id` |
| 5 | add_turn_explain_count | `turn.explain_count` |
| 6 | add_turn_bilingual_count | `turn.bilingual_count` |
| 7 | create_mastery_event | `mastery_event` |
| 8 | create_mastery_event_key_index | `mastery_event(key, created_at)` |
| 9 | create_mastery_event_turn_index | `mastery_event(turn_id)` |
| 10 | create_app_state | `app_state` |
| 11 | create_learning_agent | `learning_agent` |
| 12 | add_conversation_kind | `conversation.kind` |
| 13 | add_conversation_learning_agent_id | `conversation.learning_agent_id` |
| 14 | add_conversation_summary | `conversation.summary` |
| 15 | add_conversation_summary_through_id | `conversation.summary_through_id` |
| 16 | add_learning_agent_version | `learning_agent.version` |
| 17 | add_learning_agent_allowed_tools_json | `learning_agent.allowed_tools_json` |
| 18 | add_learning_agent_writeback_policy | `learning_agent.writeback_policy` |
| 19 | add_learning_agent_output_schema_json | `learning_agent.output_schema_json` |
| 20 | create_agent_job | `agent_job` |
| 21 | create_learning_project | `learning_project` |
| 22 | add_agent_job_turn_id | `agent_job.turn_id` |
| 23 | add_conversation_parent_id | `conversation.parent_conversation_id` |
| 24 | add_conversation_branch_source_turn_id | `conversation.branch_source_turn_id` |
| 25 | add_conversation_branch_kind | `conversation.branch_kind` |
| 26 | add_conversation_agent_modifiers_json | `conversation.agent_modifiers_json` |
| 27 | add_learning_agent_kind | `learning_agent.kind` |
| 28 | add_learning_agent_hook | `learning_agent.hook` |
| 29 | add_learning_agent_enabled | `learning_agent.enabled` |
| 30 | create_turn_annotation | `turn_annotation` |
| 31 | create_memory_proposal | `memory_proposal` |
| 32 | add_turn_exclude_from_context | `turn.exclude_from_context` |
| 33 | add_learning_agent_package_meta_json | `learning_agent.package_meta_json` |
| 34 | add_turn_display_text | `turn.display_text`(提示词宏气泡原文) |
| 35 | create_turn_conversation_index | `turn(conversation_id, created_at)` 索引(会话上下文加载不再全表扫) |
| 36 | add_conversation_pinned | `conversation.pinned`(侧栏置顶) |

### `mastery_item`(掌握项,起点,别一上来搞知识追踪)

```ts
{
  id: string
  type: 'vocab' | 'grammar' | 'collocation' | 'error_pattern' | 'expression_gap'
  key: string              // 稳定 upsert 键,= Issue.mastery_key,如 "grammar:article_usage"
  label: string            // "冠词 a/an/the 的用法"
  status: 'struggling' | 'learning' | 'known'
  seen_count: number       // 用户产出观察次数(error/correct/gap);introduced 不增加
  error_count: number
  last_seen_at: number
  example?: string         // 用户真实出错句 / gap 的原始母语/混说输入
  notes?: string           // 用户可编辑 / gap 的目标语表达
}
```

`introduced` 是曝光证据(老师/批改新引入),不是用户已经会用的证据:它会创建/保留学习项、
更新 `last_seen_at`,但不增加 `seen_count/error_count`,因此不会把条目推到 `known`。

### `mastery_event`(观察事件,可追溯证据)

```ts
{
  id: string
  created_at: number
  turn_id?: string           // 对应 turn;未来复习/手动事件可为空或另设 source
  key: string
  label: string
  type: MasteryType
  kind: 'error' | 'correct' | 'introduced' | 'gap'
  source: 'tutor' | 'review' | 'manual'
  evidence?: string          // 用户原句片段 / key item / gap 原句
  note?: string              // gap 的目标语表达等短文本
  payload_json?: string      // 原始结构化证据,用于审计 / 以后重算 mastery_item
}
```

`mastery_item` 是当前可查询快照;`mastery_event` 是不可丢的证据日志。以后调整掌握公式、
合并 key、做复习页或排查 LLM 误判时,可以从事件重算快照,不只依赖一个被覆盖的 example。

### `app_state`(内部连续性标记)

少量应用内部 marker 放这里,例如 Profile Maintainer 的 `lastMaintainedAt` 水位。它不是用户偏好,
但必须随数据库备份/迁移,否则会重复维护或漏维护。

`type` 是裸 `TEXT`(无 CHECK),新增掌握类型(如 `expression_gap`)只改 TS 侧共享常量(`src/db/mastery-values.ts`),不需要 Rust 迁移。记账公式见 [tutor-agent](./tutor-agent.md#代码侧记账分数归代码管)。

`key` 写入前由代码统一规整(`normalizeKey`,`db/mastery-logic.ts`:小写 / 空格→下划线 / 去冒号旁下划线),作为「同类错同一个 key」的兜底——LLM 偶尔的大小写/空格漂移不会再分叉成两条记录。

### `conversation` / `turn`(多会话)

`conversation`(侧边栏列表,ChatGPT 式:首条消息后标题改成截断的输入)+ `turn`(每轮 input/reply/analysis JSON,挂在 conversation 下)。`conversation.kind` 区分普通练习与 `learning_agent` 专项课会话;专项课用 `learning_agent_id` 找到对应老师 prompt。`conversation.pinned`(v36)驱动侧栏置顶;侧栏列表按 置顶 → 今天 → 本周 → 更早 分组。代码在 `src/db/{conversations,turns}.ts`。

删除会话会级联清理挂在其 turns 上的 `turn_annotation` / `memory_proposal` / `agent_job` 与 `app_state` 的 inputHints 缓存,并把子分支的 `parent_conversation_id` 置空;**`mastery_event` 刻意保留**(它是掌握计数背后的永久证据日志)。「从此处重新编辑」截断 turns 时同样级联。

### `learning_agent`(定制化学习 Agent / 自定义 Runtime Agent)

```ts
{
  id: string
  name: string
  description: string
  prompt: string
  data_scope_json: string // profile / comfortable / weak_all / weak_grammar / expression_gaps / today_turns / due_review / proficiency
  kind: 'lesson' | 'observer' | 'action'
  hook?: 'conversation.observe' | 'conversation.action'
  enabled: number
  version: number
  allowed_tools_json: string // v1: [] 或 ["read_learning_data"]
  writeback_policy: 'none' | 'propose_review_signals'
  output_schema_json?: string
  package_meta_json?: string // 导入来源:package id/version/item/source/hash/installed_at
  built_in: number        // 内置 Agent 也落库,允许用户微调 prompt
  created_at: number
  updated_at: number
}
```

`kind="lesson"` 是专项课:不跑普通 Tutor Agent,因此不会把用户在课堂里的母语问题误记成表达缺口;老师直接在聊天中解释和反馈。`kind="observer" | "action"` 是自定义 Runtime Agent:启动 / 刷新时由 `reloadCustomRuntimeAgents()` 从 DB 加载进内存注册表。observer 输出只写 `turn_annotation`;若 `writeback_policy="propose_review_signals"`,只能创建 `memory_proposal`,等待用户确认后由代码执行有限数据操作。详见 [lessons.md](./lessons.md)。

### `turn_annotation` / `memory_proposal`(自定义 Agent 可见产物)

`turn_annotation` 把自定义 observer 的结果挂到某一轮,供 Coach Panel 展示,不污染主 `turn.analysis_json`。

`memory_proposal` 是待确认的学习数据写入队列:

```ts
{
  id: string
  status: 'pending' | 'applied' | 'dismissed'
  agent_id: string
  turn_id?: string
  summary: string
  operations_json: string // create/update/delete/merge mastery item 的有限操作
  result_json?: string
}
```

确认时走 `applyDataEditOperations`:代码校验 key/type/status/action,只允许 create/update/delete/merge/状态修改,不允许 Agent 改计数、密钥或 provider 设置。

### `agent_job` / `learning_project`(Agent 作业 / 运行日志)

`agent_job` 记录两类可追踪事件:后台 / 异步 agent 作业(Task Agent、维护、摘要等),以及热路径 / 按需 agent 的已完成运行日志(`source="conversation"`,可关联 `turn_id`)。它现在是统一审计日志,不是只服务 Task Agent 的队列表:

```ts
{
  id: string
  kind: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  input_json?: string
  output_json?: string
  error?: string
  source: 'task_agent' | 'maintainer' | 'summary' | 'manual' | 'conversation'
  turn_id?: string
  created_at: number
  updated_at: number
  started_at?: number
  finished_at?: number
}
```

`agent_job` 是运维日志而非学习证据:启动时自动清理 30 天前的已完成行(`pruneAgentJobs`,pending/running 永不清),防止热路径日志无限增长。

`learning_project` 保存 Task Agent 产出的学习计划:

```ts
{
  id: string
  title: string
  goal: string
  status: 'active' | 'completed' | 'archived'
  plan_md: string
  notes_md: string
  source_prompt?: string
  task_plan_json?: string
  created_at: number
  updated_at: number
}
```

Task Agent 只产出项目计划和专项课草案;落库与创建课程包由代码执行,且不写 mastery。详见 [lessons.md](./lessons.md)。

### 选 top-N 喂回 prompt

不能把整表塞进 prompt。每轮按**薄弱 + 近期**选少量(`getWeakList`):

```sql
SELECT key, label, type, status
FROM mastery_item
WHERE status != 'known'
-- 分母 +2 收缩:压低样本极少的项,免得「1/1=100%」噪音盖过反复出错的老问题。
ORDER BY (error_count * 1.0 / (seen_count + 2)) DESC, last_seen_at DESC
LIMIT 15;
```

规则不够用时再考虑用向量做"相关性检索"——那才是向量库该出场的地方,**不是 v1**。

## Provider 适配器(BYOK)

`ModelProvider` 接口只有 `generate` / `stream`(`src/providers/types.ts`),agent-core 全程 provider 无关。已实现三个适配器:

| Provider | 文件 | 结构化输出 |
|---|---|---|
| OpenAI 兼容(OpenAI / OpenRouter / LM Studio) | `providers/openai.ts` | `response_format: json_schema` |
| Anthropic(Claude) | `providers/anthropic.ts` | schema 作单个 tool 的 input_schema,强制调用 |
| Gemini(原生 API) | `providers/gemini.ts` | `responseSchema` |

provider 解析全在 TS;**LLM HTTP 走 Rust**(`src-tauri/src/llm.rs` 的 `llm_request` / `llm_stream`,reqwest),绕过 webview CORS;流式用 reqwest `bytes_stream` + tauri `Channel` 推到前端,前端解析 SSE。config(非密)存 localStorage(`src/config.ts`),每个 provider 的 key 单独存,切换不丢。

### 订阅登录 provider(OAuth:Claude Code / Codex)

除填 API key 外,还支持用 **Claude Pro/Max** 与 **ChatGPT** 订阅经浏览器 OAuth 登录(provider 类型 `claude-oauth` / `codex-oauth`,实现参照 [openclaw](https://github.com/openclaw/openclaw))。常量与来源逐一核对自 openclaw `main`,记在各 `src/oauth/*.ts` 顶部。

- **流程**(`src/oauth/{pkce,store,anthropic,openai}.ts`):PKCE → `openUrl` 打开授权页 → Rust 一次性 loopback 回调服务捕获 `code`(`src-tauri/src/oauth.rs` 的 `oauth_listen`,监听 `127.0.0.1:53692`(Claude)/ `:1455`(Codex))→ 换 token。令牌 `{access,refresh,expires,accountId?}` 走同一加密通道存(account `${type}_oauth`)。`getProvider` 在热路径上检查过期并**单飞刷新**(`ensureFreshTokens`,避免对话 ∥ 导师并发各刷一次)。
- **Claude(`claude-oauth`)**:复用 anthropic 适配器的 `oauth` 模式——`Authorization: Bearer`(去 x-api-key)+ `anthropic-beta: claude-code-20250219,oauth-2025-04-20`,且首个 system 块固定为 `"You are Claude Code, Anthropic's official CLI for Claude."`(服务端强制)。直连 `https://api.anthropic.com/v1`。
- **Codex(`codex-oauth`)**:新增 Responses API 适配器(`providers/openai-responses.ts`),走 `https://chatgpt.com/backend-api/codex/responses`(非 chat/completions),body 用 `instructions`+`input`、`store:false`,header 带 `chatgpt-account-id`(从 access JWT 解出);SSE 解析 `response.output_text.delta` / `response.completed`。OpenAI token endpoint 要表单编码,故 token 交换/刷新走 `oauth_token_post`(Rust,`reqwest .form`),而非发 JSON 的 `llm_request`。
- ⚠️ 第三方使用订阅令牌可能违反对应服务条款、有账号被标记风险;设置页登录处有提示。Codex 一侧的 Responses 线格式无法离线联调,需真账号验证。

## 用户体验偏好

长期体验偏好写在 MD 档案的 `## AI preferences` 段,不放设置页开关。
档案页提供两个入口:一句话自然语言描述 → AI 自动归类到模块;或展开高级区按模块手动编辑。
代码用 `formatExperiencePreferences(profileMd, scope)` 按流程分发:

- `conversation`:普通对话回复
- `tutor`:导师批改 + mastery 记账
- `learning`:专项课 / Learning Agent
- `reading`:讲解、划词翻译、双语阅读

通用原则:主观偏好(地区英语、语气、回复长度、讲解风格)作为 scoped instruction
喂给对应 agent;可确定执行的偏好(如忽略纯大小写 / 纯标点问题)同时做代码侧兜底,
避免模型偶尔上报后进入 UI 和 mastery 计数。

## 密钥存储(应用自管加密,绝不明文)

`src-tauri/src/secrets.rs`:XChaCha20-Poly1305 加密,密钥 = 本地随机 keyfile(0600)+ 机器标识 SHA-256 派生 → **设备绑定、无主密码**。前端 `src/keychain.ts` 走 `set/get/delete_secret` 命令。

⚠️ 安全上限:无主密码 = **混淆级**,挡误传 / 随手翻,挡不住能读你磁盘的攻击者。要真加密需主密码(届时换 `tauri-plugin-stronghold`)。

## 按需讲解(Explain Agent)

不在热路径。用户点对话回复上的「讲解」按钮时触发(`orchestrator.explainReply` → `agents/explain.ts` → `components/ReplyExplanation.tsx`)。它和对话 agent **同源读 MD 档案切片**,据此判断"这个学习者大概哪里看不懂",只讲该讲的,用**母语**流式输出,不讲显而易见的。**侧重语法结构 / 习语 / 地道用法等逐词读不出来的部分,不逐词解释单词**(单词让学习者自己查,除非在此处含义不显)。按需讲解 / 双语阅读 / 划词解析作为 `transformer` 登记进能力库;调用时经 `runTransformer` 记录 `agent_job` 运行日志,但不持久化生成的正文。

## 数据备份与设置持久化

- **备份**(设置 → 通用):`src/lib/backup.ts` 把全部 SQLite 表 + learner-profile.md + 非密设置打成单个可读 JSON,经 Rust `export_backup` 原子写入「下载」目录并在文件管理器高亮;导入走 `<input type="file">`,确认后**整体替换**并重载应用。密钥/令牌绝不进备份。
- **设置镜像**(`src/lib/settings-mirror.ts`):localStorage 仍是同步真相源,但用户资产类 key(provider 配置、TTS/STT、键位、宏、agent 开关、locale/主题)写入 `app_state` 快照;启动时(render 前,`main.tsx` boot)把本地缺失的 key 从镜像恢复——WebView 数据被系统清掉也不丢配置,且随备份迁移。纯 UI 痕迹(面板宽度等)刻意不入镜像。

## 语音输入(STT)

`src/stt/*` + `components/MicButton.tsx`(输入区麦克风按钮,Esc 取消)。STT 在设置 → 语音输入单独配置(`lang-agent.stt`),三条路径:

- **Soniox(默认,实时流式)**:`stt/realtime.ts` 直连 `wss://stt-rt.soniox.com/transcribe-websocket`(WS 无 CORS,只需 CSP `connect-src` 放行,不走 Rust);采集用 AudioWorklet(`public/pcm-worklet.js`,音频线程攒 s16le PCM 块,CSP `script-src 'self'` 禁 blob: 模块所以放 public/),token 边到边以 onPartial 实时拼进输入框(ChatView `sttBaseRef` 记底稿,取消/出错回滚),再点结束发空帧让服务端 flush 出最终文本。默认 `stt-rt-v3`(旧存量 `stt-async-*` 加载时迁移),语言提示来自母语+目标语,仍启用自动语言识别。
- **OpenAI 兼容(批量)**:webview MediaRecorder 录完整段(WebKit 出 mp4/aac,Chromium 出 webm/opus),上传走 Rust `stt.rs` 的 `stt_transcribe`(OpenAI 风格 `/audio/transcriptions`,OpenAI/Groq/本地 Whisper 等)绕 webview CORS,不固定 language 参数——母语/混说是核心链路。
- **Parakeet TDT 0.6B V3(本地,批量)**:`stt/local.ts` + Rust `stt_local.rs`,经 `sherpa-onnx` crate 做端侧离线推理,**无 key、下载后无需联网**。复用同一 `pcm-worklet.js` 采集整段 s16le(AudioContext 尽量按 16k,WebKit 忽略时由 Rust 线性重采样兜底),base64 交 `stt_transcribe_parakeet` 一次出文本(无流式)。模型 ~640MB 不打包,首次用时从 HuggingFace `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` 逐文件下载到 `app_config_dir/models/parakeet-tdt-0.6b-v3/`(进度走 `tauri::ipc::Channel`,原子写 `.part`→rename),`OfflineRecognizer` 懒加载全局缓存。**仅 25 种欧洲语言,无中日韩**——定位是学欧洲语言用户的离线/免 key 选项,不替代 Soniox 混说主路径。`sherpa-onnx` 的 build script 编译时联网拉预编译静态库(含 onnxruntime,产物 +30–50MB);离线/CI 需预设 `SHERPA_ONNX_LIB_DIR`。

两类云端 key 分别存加密账户 `soniox_stt_api_key` / `stt_api_key`(Parakeet 无 key),STT 供应商可与对话 provider 不同。macOS 需要 `src-tauri/Info.plist` 的 `NSMicrophoneUsageDescription`(打包时由 Tauri 合并;真机首次使用会弹系统麦克风授权)。

## 朗读(TTS)

`src/tts/*` + `components/SpeakButton.tsx`。**可切换引擎**(`tts/config.ts` 的 `ttsProvider`),`tts/speak.ts` 按引擎把「如何合成」收敛成一个 thunk,缓存(`tts/cache.ts`,按文本 + 配置哈希)/ 单飞去重 / Web Audio 播放(`tts/playback.ts`)两引擎共用:

- **MiMo TTS**(`tts/mimo.ts`):OpenAI 风格 `chat/completions` + `audio` 字段,HTTP 走 Rust,需单独加密存的 key;voice / 风格 prompt / baseUrl 在设置页可配。
- **微软 Edge「朗读」**(`tts/edge.ts` → Rust `edge_tts.rs` 的 `edge_tts_synthesize`):**免费、无需 key**。Edge read-aloud 是 WebSocket 服务,且校验 `Origin` 头(webview 无法改写),故合成走 Rust(`tokio-tungstenite`):生成 `Sec-MS-GEC` DRM 令牌(SHA-256,复刻 edge-tts 的 f64 取整)→ 连 WSS → 发 speech.config + SSML → 收二进制帧拼 MP3 → base64 回传。输出用 `audio-24khz-48kbitrate-mono-mp3`(readaloud 端点只接受 mp3,RIFF/WAV 会返 0 音频);`playback.ts` 按内容嗅探 MIME,mp3/wav 都能放。voice / 语速 / 音高在设置页可配。

## 缓存与延迟

- 热路径三个主 prompt(对话 / 导师 / 专项课)都按**稳定优先拆成多条 system 消息**:①稳定规则(只依赖语言配置)②慢变上下文(偏好 / MD 档案 / 课程 prompt)③每轮动态数据(随输入重排的弱项 / 复习 / 脚手架清单、摘要)。各 agent 的块划分见各自契约文档。
- **Anthropic**(`providers/anthropic.ts`):每条 system 消息映射成独立 system block,**除最后一块外**的块打 `cache_control` 断点(上限 3)——稳定前缀跨轮、跨会话命中,动态尾巴不再为每轮必失效的缓存付 25% 写入溢价。单条 system 的小 agent(讲解/翻译等,prompt 全稳定)保持整块断点。
- **OpenAI 兼容**(`providers/openai.ts`):发送前把多条 system 合并回单条(很多兼容端点的 chat template 只认第一条 system),合并文本与拆分前一致;自动前缀缓存受益于稳定优先的排序。Gemini / Codex Responses 同样在适配器内合并。
- ⚠️ 缓存只省**输入** token,且有最小长度门槛(低于门槛的断点静默不生效,无额外成本)。多 agent **不比单调用便宜**。真正收益是**延迟**(并行 + 对话流式秒回)和**关注点分离**,缓存是在此之上把重复前缀的成本压下来。

## 复习去哪了

砍掉抽认卡 SRS。复习靠对话 agent 在聊天里**被动复用**薄弱项/最近学到项(interleaving),比抽认卡更自然,且不需要排程 UI。复习候选不再只靠维护 agent 写进 prose:代码每轮用 `getReviewDueList` 定向选出一小撮喂给对话 agent(`DUE FOR REVIEW` 段),对话 agent 自然带出一两个——代码选取、LLM 复用。

`getReviewDueList` 不是纯 `last_seen_at` 排序:它从 `seen_count / error_count / status / last_seen_at` 派生 retention,近似 `retention = exp(-elapsed_days / strength)`。`correct` 证据越多 strength 越高,`error/gap` 越多 strength 越低;最终用 `dueScore = (1 - retention) * statusNeed + errorRate` 排序。这样 `due_review` 表达的是"保持率已经掉下来了,该复习",而不只是"很久没见"。

`known` 项不会进入弱项表,但会通过 `getComfortableList` 作为结构化"已掌握脚手架"喂给对话 agent / 专项课数据上下文。它的用途是告诉 agent 哪些表达可以放心复用、迁移和作为解释支架,不要每轮只围着错误转。

显式复习现在由**专项课**承接:侧边栏顶部的定制化学习入口内置「今日复盘」「语法专项复习」「表达缺口训练」,它们新开学习会话,使用老师型 prompt 和有界数据上下文。旧设计里的独立 `review_day` 缓存页暂不做;先把复习产品形态收敛到专项课。

## 状态 / 路线图

v1 核心链路已完成并可用:

- ✅ Tauri scaffold · SQLite(Drizzle sqlite-proxy)· 三个 provider 适配器 · 加密密钥存储
- ✅ 导师链路(结构化 `TutorAnalysis` + 代码记账)· 对话链路(流式)· orchestrator 端到端
- ✅ MD 档案读写 + 维护 agent(含 sanity check、每 10 轮/空闲/切换会话触发)· `## About me` 个人记忆
- ✅ 多会话侧边栏 · Markdown 回复 · 按需讲解 · 朗读(TTS)· 母语/混说表达缺口(见 expression-gap)
- ✅ 理解信号(每条回复的讲解/双语请求数)· retention 驱动的复习候选(`getReviewDueList`)· 已掌握脚手架(`getComfortableList`)· 证据驱动的难度校准(`lib/proficiency`,喂对话 agent)
- ✅ `mastery_event` 事件日志:每条 error/correct/introduced/gap 都保留结构化证据,`introduced` 不再推动掌握毕业
- ✅ 定制化学习 Agent / 专项课:内置今日复盘、语法专项复习、表达缺口训练;支持自然语言创建和 prompt 微调;专项课会话独立于普通批改热路径;课堂回答可由用户确认后回写 `correct` 复习信号
- ✅ Task Agent / 学习项目:把开放式学习需求规划成 `learning_project`,并生成有界专项课草案;`agent_job` 记录作业状态
- ✅ 学习数据页自然语言修改:LLM 只生成有限操作,代码执行 create/update/delete/merge/状态修改,不让 LLM 直接碰计数
- ✅ 最小 UI:聊天 / 批改面板 / 档案查看编辑(含 AI 自定义偏好) / 学习数据管理 / 设置(provider + key + STT/TTS)
- ✅ 教练面板:右栏常驻 Coach Panel,展示本轮反馈 + 本轮「系统记下了什么」(`deriveSignals` 同源);三栏工作台布局(侧栏 / 对话 / 教练),窄屏降级为抽屉。后续界面打磨见 [ui-guide.md](./ui-guide.md)
- ✅ 会话动作 + 分支:`conversation.action` action Agent(从此处分支 / 重新开始 / 升降难度 / 调换角色 / 第二天继续)非破坏式派生分支(`conversation` 加 parent/branch_kind/agent_modifiers 列,migration v23–v26),修饰符经 `SESSION ADJUSTMENTS` 注入对话回复;动作条与按钮由注册表驱动。
- ✅ Agent 能力库:能力库页(侧栏 → 能力库)按 kind 展示注册表里的内置 Agent(做什么/时机/读写)、启用/禁用(`runtime/enablement.ts`,localStorage)、运行日志(`agent_job`)。按需讲解 / 双语阅读 / 划词解析也作为不可关闭的 `transformer` 能力展示并记录运行日志。能力库真相源是内存注册表,未把代码 Agent 同步进 DB。
- ✅ 自定义 Agent(Agent-first Phase 5):能力库提供 6 问式 prompt Agent 创建(observer/action)。observer 每轮产出 `turn_annotation` 并可提出 `memory_proposal`;Coach Panel 展示自定义观察和待确认记忆,确认后由代码执行有限数据操作。action 通过 LLM 生成分支指令并创建非破坏式分支;内置「变成专项课」动作可从当前会话生成专项课并跳转。
- ✅ 分享包 / 开发者 package(Agent-first Phase 6+):能力库与专项课页支持导入/导出商店兼容的 `lang-agent.package` JSON,一个包可包含 skill(observer/action)、lesson 和 course 草案;导入前展示读取/写入权限预览并校验白名单。旧的 runtime-only `lang-agent.agent-package` 仍保留兼容导入。
- ✅ 首启引导:无任何数据时显示两步向导(界面/母语/目标语/水平 → provider + key/订阅登录 + 连接测试);完成/跳过后写 `app_state` 标记,老用户静默跳过
- ✅ 数据备份:一键导出/导入单文件 JSON(全部表 + MD 档案 + 设置);设置镜像保证 localStorage 被清也不丢配置
- ✅ 语音输入(STT):输入区麦克风按钮,BYOK Soniox 实时流式(边说边出字)/ OpenAI 兼容批量转写端点;转写文本进输入框确认后发送
- ✅ 复习可见性:Coach 面板「今日到期复习」(与喂给对话 agent 的 `getReviewDueList` 同源);学习数据页每条目可展开 `mastery_event` 证据时间线
- ✅ 数据卫生:`turn(conversation_id, created_at)` 索引;删除/截断会话级联清理 turn 级产物;`agent_job` 30 天保留窗口;Coach 面板由轮询改为事件驱动(`lib/app-events.ts`)
- ✅ 侧栏置顶 + 日期分组(置顶 / 今天 / 本周 / 更早);错误信息全量走 i18n(orchestrator/maintainer/STT/TTS)
- ✅ 听写自适应:听错词记成隔离的 `listening:<word>` 维度(生产向查询全部排除该前缀;正确转写由代码反推 correct 信号,migration v39 清理旧 `dictation:*` 聚合项);到期听力词编入后续句子;慢速重听(0.7×)+ 重听计数作为下一句难度信号;难度校准窗口排除听写/跟读轮(`getRecentProductionTurns`)
- ✅ 弱项闪练(主动检索训练):代码用 `getReviewDueList` 选 5 个到期项快照进会话修饰符,agent 每轮定向出一个「必须用到该项」的微任务;到期项前置进导师弱项表,correct/error 信号干净落在目标 key 上
- ✅ 跟读(影子练习):听写的镜像 —— 同一 `[[SAY]]` 契约,句子可见,TTS 念示范、学习者跟读、STT 转写按标准答案 diff(发音粗信号,不写 mastery)
- ✅ 情景演练(原快问快答改名):复习项定向出题(场景使理想答案自然要求 DUE-FOR-REVIEW 项)+ 明显没完成任务时同题重试一次
- ✅ 普通对话复习 elicitation(交替「自己示范」与「设计让用户必须产出的问题」)+ 批改面板「重说一遍」(把改对的意思凭记忆再产出一次,走正常批改)
- ✅ 专项课课程回顾:会话级回写 observer 一次扫全课 transcript,批量提出 correct 证据(≤8 条),用户一键确认后 `recordSignals(source="review")` 入账
- ✅ 学习项目进度:`learning_project` 关联生成课程(migration v37/v38),逐课完成标记 + 进度 + 下一课;今日训练页(侧栏「今日训练」)用已有数据拼每日清单(到期复习 → 闪练、听漏词 → 听写、进行中项目 → 下一课,完成态由当日会话类型推导)

## 踩坑记录

- **`bitflags`**:2.12.0 在 Rust 1.96 下编译 `dispatch2`(wry 传递依赖)触发宏递归上限。`Cargo.lock` 已钉 `bitflags 2.9.1`。**别随手 `cargo update`** 升回去,否则后端编译挂。
- **pnpm v11** 默认拦截依赖 build 脚本;`pnpm-workspace.yaml` 里放行 `esbuild`(否则报 `ERR_PNPM_IGNORED_BUILDS`)。
- **sqlite-proxy 桥接**(`src/db/client.ts`):Drizzle 生成 `?` 占位符,sqlx 原生接受可直接透传;`run` 走 plugin `execute`,`all/values/get` 走 `select` 后 `Object.values` 还原成 Drizzle 要的值数组(列序 = SELECT 序)。权限:`capabilities/default.json` 需 `sql:default` + `sql:allow-load/execute/select`。
- **zod 钉 v3**:`zod-to-json-schema` 为 v3 设计;`tutorJsonSchema()` 去 `$schema`、inline refs(`$refStrategy: "none"`)让 OpenAI 端点能直接吃。
- **原子写 MD**:Rust 侧写临时文件再 rename(`src-tauri/src/profile.rs`),避免对话 agent 读到半截文件。
- **日期用 UTC**。例外:学习成就页的打卡/热力图按**本地日**统计(`db/learning-stats.ts` 的 `localDayNumber`)——「今天练没练」对用户是本地概念。
- **双平台(macOS + Windows)**:新增原生 / chrome 功能遵守 [cross-platform.md](./cross-platform.md) 的三条约定(`cfg` 守卫 / `data-platform` / 薄 port);CI 在 macOS + Windows 都跑 `cargo build`。
