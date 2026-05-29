# Build Plan (v1)

有序、可验证的开工任务。**按顺序做,一次一个,达到"验收"再下一个。** 设计细节见 [README](./README.md) 和 [architecture](./architecture.md)。

状态标记:`[ ]` 未做 · `[~]` 进行中 · `[x]` 完成。

---

## 阶段 A —— 先验证,别急着写功能

### [x] Task 0 · Scaffold Tauri 应用
- 在仓库根用 Tauri v2 + React + TypeScript + Vite 起项目(pnpm)。保留现有 `docs/`、`CLAUDE.md`。
- **验收:** `pnpm tauri dev` 能打开一个空白桌面窗口,热重载正常。
- ✅ 已完成。Rust 1.96 + Tauri 2.11,前端 React 19 + Vite 7。`pnpm tauri dev` 开窗成功,HMR 已验证(`vite hmr update`)。
- ⚠️ 坑:`bitflags` 2.12.0 在 Rust 1.96 下编译 `dispatch2`(wry 传递依赖)会触发宏递归上限。已在 `Cargo.lock` 钉到 `bitflags 2.9.1`。**别随手 `cargo update`** 把它升回去,否则后端编译挂。
- ⚠️ pnpm v11 默认拦截依赖 build 脚本;`pnpm-workspace.yaml` 里 `allowBuilds: { esbuild: true }` 放行(否则 `pnpm dev/build` 报 ERR_PNPM_IGNORED_BUILDS)。

### [x] Task 1 · SQLite 技术探针(最高风险,先打掉)
- 接入 `tauri-plugin-sql`;用 Drizzle 的 **sqlite-proxy** driver 桥接(Drizzle 的查询回调里调用 plugin 的 execute/select —— 因为 webview 不是 Node,没有 better-sqlite3)。
- 建 `mastery_item` 表的 migration(字段见 [architecture](./architecture.md#sqlitemastery_item起点别一上来搞知识追踪)),写一行、读回来。
- **验收:** 应用启动跑 migration;一段测试代码能 upsert 一个 mastery_item 并读回,字段无误。
- ✅ 已完成并实测(用 sqlite3 直查 `~/Library/Application Support/com.langagent.app/lang-agent.db`):migration 启动即跑、insert + 冲突 update(`onConflictDoUpdate`)+ 读回字段全对、二次运行不重复且 `last_seen_at` 更新。
- 桥接关键事实(踩过的点):
  - migration 定义在 **Rust 侧**(`tauri_plugin_sql::Builder::add_migrations("sqlite:lang-agent.db", ...)`),`Database.load()` 时触发;Drizzle 只做类型安全查询,不接管 migration。
  - **占位符**:Drizzle sqlite 方言生成 `?`,sqlx 的 SQLite 驱动原生接受 `?`,可直接透传(plugin 文档写 `$1` 只是其推荐风格,非强制)——无需重写。
  - proxy 回调:`run` 走 `execute` 返 `{rows:[]}`;`all/values/get` 走 `select`(返回对象数组)→ `Object.values` 还原成 Drizzle 要的**值数组**,列序 = SELECT 序,实测对齐正确。
  - 权限:`capabilities/default.json` 需 `sql:default` + `sql:allow-load/execute/select`。
- 文件:`src/db/schema.ts`(Drizzle 表,手动镜像 Rust migration)· `src/db/client.ts`(sqlite-proxy 桥接)· `src/db/probe.ts`(探针)· `App.tsx`(临时探针 UI,后续任务替换)。

### [ ] Task 2 · Provider 适配器(BYOK)
- 定义 `ModelProvider` 接口(`generate` / `stream`);实现 **一个 OpenAI 兼容适配器**(覆盖 OpenAI/OpenRouter/LM Studio)。Anthropic 适配器留到 v1 后期。
- API key 从设置读,存 OS keychain,**不明文**。
- **验收:** 用用户填的 key,一个硬编码 prompt 能拿到文本返回(stream 和非 stream 各跑通一次)。

---

## 阶段 B —— 导师链路(结构化,先于对话)

### [ ] Task 3 · Tutor Agent 结构化调用
- 落地 `TutorAnalysis` / `Issue` / `MasteryUpdate` 的 Zod(见 [tutor-agent](./tutor-agent.md));用 `zod-to-json-schema` 生成 JSON schema 喂给 provider 的结构化输出。
- 用 [tutor-agent](./tutor-agent.md) 的 system prompt。`safeParse` 失败要降级,不崩。
- **验收:** 一个示例错句返回**通过 Zod 校验**的 `TutorAnalysis`,`issues` 里 `mastery_key` 合理。

### [ ] Task 4 · 记账(代码侧,写 SQLite)
- 遍历 `issues[]` 派生 `error` 信号;`mastery_updates[]` 给 `correct`/`introduced` 信号。
- 按 `mastery_key` upsert 进 `mastery_item`,跑 `applySignal`(见 [tutor-agent](./tutor-agent.md#代码侧记账分数归代码管))。
- **验收:** 跑一轮后,相关 `mastery_item` 的 seen_count/error_count/status 正确更新;同一 key 第二次是 update 不是新增。

---

## 阶段 C —— 对话链路 + 编排

### [ ] Task 5 · Conversation Agent(纯文本流式)
- 用 [conversation-agent](./conversation-agent.md) 的 prompt;读 MD 档案切片(此阶段 MD 没有就用占位)。
- **验收:** 回复以目标语言流式输出到 UI。

### [ ] Task 6 · Orchestrator(端到端一轮)
- 对话 ∥ 导师并行;对话流式秒回,导师结果到批改面板;持久化本轮。共享前缀打缓存断点。
- **验收:** UI 里输入一句 → 立刻看到对话回复 → 稍后看到批改 → SQLite 有了本轮记录和掌握更新。

---

## 阶段 D —— MD 档案 + 维护 agent

### [ ] Task 7 · learner-profile.md 读写 + Maintainer
- 读写 `learner-profile.md`(原子写入);按触发条件(默认每 10 轮 / 会话结束)后台跑维护 agent(见 [profile-maintainer-agent](./profile-maintainer-agent.md)),含 sanity check。
- 对话 agent 改为真正读这份 MD。
- **验收:** 累计若干轮后,MD 档案被更新且通过 sanity check;`## My notes` 原样保留。

### [ ] Task 8 · 最小 UI 收口
- 聊天输入、回复流、批改面板、档案查看/编辑页、设置页(provider + key)。
- **验收:** 自己能完整用一遍:聊天 → 看批改 → 看/改档案。

---

## 阶段 0(并行,不写代码)
开工同时:拿 10–20 个真实句子手动验证三个 prompt,重点盯 Tutor 的 `mastery_key` 跨句**稳定性**。发现问题改 docs 里的 prompt,再同步到代码。
