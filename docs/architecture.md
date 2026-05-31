# Architecture (v1)

AI 语言学习 agent —— 第一版范围、数据流、存储与现状。Agent 的逐字契约见各自文档:[conversation](./conversation-agent.md) · [tutor](./tutor-agent.md) · [profile-maintainer](./profile-maintainer-agent.md);母语/混说链路见 [expression-gap](./expression-gap.md)。

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
| **Explain**(按需) | 用户点「讲解」时 | 对话回复 + MD 档案切片 | 母语讲解,流式 | 见下方[按需讲解](#按需讲解-explain-agent) |

热路径只有对话 ∥ 导师两个 agent;维护与讲解都不在热路径上(后台 / 按需)。代码侧的编排在 `src/orchestrator.ts`(`runTurn` = 对话 ∥ 导师 + 记账 + 持久化;`explainReply` = 按需讲解)。

## 两层存储:各管一摊(核心决策)

| 层 | 存什么 | 谁维护 | 为什么 |
|---|---|---|---|
| **SQLite**(地面真相) | 每个掌握项的 error_count / seen_count / last_seen / status | **代码**(每轮从信号派生) | 确定性、可排序查询、可画进度。LLM 不碰计数。 |
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
        expression_gap    → "gap" 信号(+ key_items 走 introduced)→ 写 SQLite
        mastery_updates[] → "correct" / "introduced" 信号 → 写 SQLite
    → 持久化本轮(turn:input / reply / analysis JSON,挂在当前 conversation 下)
    → 每 10 轮触发一次后台 Profile Maintainer(单飞)

按需:
  用户点回复上的「讲解」→ Explain Agent 读该回复 + MD 切片 → 母语流式讲解
  用户点「朗读」      → TTS(见下)合成并播放

偶尔(每 10 轮 / 手动):
  Profile Maintainer 读 现有 MD + SQLite 聚合 + 近期对话
    → 产出更新后的 learner-profile.md(Rust 侧原子写入)
```

## SQLite schema

migration 定义在 **Rust 侧**(`src-tauri/src/lib.rs`,`tauri_plugin_sql::Builder::add_migrations`),`Database.load()` 时触发。Drizzle 只做类型安全查询,不接管 migration —— TS 侧 `src/db/schema.ts` **手动镜像** Rust 的建表,两边保持一致。

当前 4 个 migration:

| ver | 描述 | 表 / 变更 |
|---|---|---|
| 1 | create_mastery_item | `mastery_item` |
| 2 | create_turn | `turn` |
| 3 | create_conversation | `conversation` |
| 4 | add_turn_conversation_id | `turn.conversation_id` |

### `mastery_item`(掌握项,起点,别一上来搞知识追踪)

```ts
{
  id: string
  type: 'vocab' | 'grammar' | 'collocation' | 'error_pattern' | 'expression_gap'
  key: string              // 稳定 upsert 键,= Issue.mastery_key,如 "grammar:article_usage"
  label: string            // "冠词 a/an/the 的用法"
  status: 'struggling' | 'learning' | 'known'
  seen_count: number
  error_count: number
  last_seen_at: number
  example?: string         // 用户真实出错句 / gap 的地道说法,最有价值
  notes?: string           // 用户可编辑 / gap 的场景说明
}
```

`type` 是裸 `TEXT`(无 CHECK),新增掌握类型(如 `expression_gap`)只改 TS 侧两个 enum(`agents/schema.ts` Zod + `db/schema.ts` drizzle),不需要 Rust 迁移。记账公式见 [tutor-agent](./tutor-agent.md#代码侧记账分数归代码管)。

`key` 写入前由代码统一规整(`normalizeKey`,`db/mastery-logic.ts`:小写 / 空格→下划线 / 去冒号旁下划线),作为「同类错同一个 key」的兜底——LLM 偶尔的大小写/空格漂移不会再分叉成两条记录。

### `conversation` / `turn`(多会话)

`conversation`(侧边栏列表,ChatGPT 式:首条消息后标题改成截断的输入)+ `turn`(每轮 input/reply/analysis JSON,挂在 conversation 下)。代码在 `src/db/{conversations,turns}.ts`。

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

## 密钥存储(应用自管加密,绝不明文)

`src-tauri/src/secrets.rs`:XChaCha20-Poly1305 加密,密钥 = 本地随机 keyfile(0600)+ 机器标识 SHA-256 派生 → **设备绑定、无主密码**。前端 `src/keychain.ts` 走 `set/get/delete_secret` 命令。

⚠️ 安全上限:无主密码 = **混淆级**,挡误传 / 随手翻,挡不住能读你磁盘的攻击者。要真加密需主密码(届时换 `tauri-plugin-stronghold`)。

## 按需讲解(Explain Agent)

不在热路径。用户点对话回复上的「讲解」按钮时触发(`orchestrator.explainReply` → `agents/explain.ts` → `components/ReplyExplanation.tsx`)。它和对话 agent **同源读 MD 档案切片**,据此判断"这个学习者大概哪里看不懂",只讲该讲的,用**母语**流式输出,不讲显而易见的。**侧重语法结构 / 习语 / 地道用法等逐词读不出来的部分,不逐词解释单词**(单词让学习者自己查,除非在此处含义不显)。

## 朗读(TTS)

`src/tts/*` + `components/SpeakButton.tsx`。当前接 **MiMo TTS**(OpenAI 风格 `chat/completions` + `audio` 字段,`tts/mimo.ts`),HTTP 同样走 Rust。本地缓存合成结果(`tts/cache.ts`,按文本 + 配置哈希)+ 单飞去重 + Web Audio 播放(`tts/playback.ts`)。voice / 风格 prompt / baseUrl 在设置页可配(`tts/config.ts`),key 单独加密存。

## 缓存与延迟

- 把稳定的 system 段放最前打缓存断点(Anthropic `cache_control` / OpenAI 自动前缀缓存);profile/weak-list 每轮变,放断点之后。两个热 agent 共享前缀 → 命中。
- ⚠️ 缓存只省**输入** token,且有最小长度门槛。多 agent **不比单调用便宜**(略贵 10–15%)。真正收益是**延迟**(并行 + 对话流式秒回)和**关注点分离**,不是省钱。
- OpenAI 自动前缀缓存即生效;Anthropic 的显式 `cache_control` 留到需要时再加。

## 复习去哪了

砍掉抽认卡 SRS。复习靠对话 agent 在聊天里**被动复用**薄弱项/最近学到项(interleaving),比抽认卡更自然,且不需要排程 UI。复习候选不再只靠维护 agent 写进 prose:代码每轮用 `getReviewDueList`(非 known、最久未重温优先)定向选出一小撮喂给对话 agent(`DUE FOR REVIEW` 段),对话 agent 自然带出一两个——代码选取、LLM 复用。一个**显式按天复习页**作为可选叠加层,设计在 [expression-gap §5](./expression-gap.md#5-每日复习页新顶层视图),**尚未实现**。

## 状态 / 路线图

v1 核心链路已完成并可用:

- ✅ Tauri scaffold · SQLite(Drizzle sqlite-proxy)· 三个 provider 适配器 · 加密密钥存储
- ✅ 导师链路(结构化 `TutorAnalysis` + 代码记账)· 对话链路(流式)· orchestrator 端到端
- ✅ MD 档案读写 + 维护 agent(含 sanity check)· `## About me` 个人记忆
- ✅ 多会话侧边栏 · Markdown 回复 · 按需讲解 · 朗读(TTS)· 母语/混说表达缺口(见 expression-gap)
- ✅ 最小 UI:聊天 / 批改面板 / 档案查看编辑 / 设置(provider + key + TTS)

**下一步(未实现):**

- 每日复习页 + `reviewGenerator` agent + `review_day` 缓存表(设计见 [expression-gap §5](./expression-gap.md#5-每日复习页新顶层视图))。
- 维护 agent 的「会话结束 / 空闲超时」触发(目前只有每 10 轮 + 手动)。
- Anthropic 显式 `cache_control` 缓存断点。
- ⏳ 人工验证:用真实句子盯 Tutor 的 `mastery_key` 跨句**稳定性**(prompt 改动记得 docs 与 `src/agents/*.ts` 两处同步)。

## 踩坑记录

- **`bitflags`**:2.12.0 在 Rust 1.96 下编译 `dispatch2`(wry 传递依赖)触发宏递归上限。`Cargo.lock` 已钉 `bitflags 2.9.1`。**别随手 `cargo update`** 升回去,否则后端编译挂。
- **pnpm v11** 默认拦截依赖 build 脚本;`pnpm-workspace.yaml` 里放行 `esbuild`(否则报 `ERR_PNPM_IGNORED_BUILDS`)。
- **sqlite-proxy 桥接**(`src/db/client.ts`):Drizzle 生成 `?` 占位符,sqlx 原生接受可直接透传;`run` 走 plugin `execute`,`all/values/get` 走 `select` 后 `Object.values` 还原成 Drizzle 要的值数组(列序 = SELECT 序)。权限:`capabilities/default.json` 需 `sql:default` + `sql:allow-load/execute/select`。
- **zod 钉 v3**:`zod-to-json-schema` 为 v3 设计;`tutorJsonSchema()` 去 `$schema`、inline refs(`$refStrategy: "none"`)让 OpenAI 端点能直接吃。
- **原子写 MD**:Rust 侧写临时文件再 rename(`src-tauri/src/profile.rs`),避免对话 agent 读到半截文件。
- **日期用 UTC**。
