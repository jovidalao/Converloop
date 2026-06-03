# Agent-first 改进路线图

把 lang-agent 从「聊天 + 若干硬编码功能」升级为 **Agent-first 语言学习工作台**的开发路线。产品愿景与目标见根目录 [CLAUDE.md](../CLAUDE.md);本文件是把愿景落到代码的**执行计划**,供后续会话直接接手。

> **核心判断:地基已铺好一大半。** 真正要新建的是四件事:① 让热路径可插拔的 **hook 运行时缝隙**;② 把散在气泡里的反馈收拢成 **Coach Panel**;③ **会话分支**;④ 让「写了什么 / 提议写什么」可见的 **turn_annotation / memory_proposal** 两张表。AgentDefinition、agent_run、dataScopes 权限、提议→校验→写入的边界,现有代码里都有可直接复用的雏形。

## 设计铁律(继承现有架构,不可破)

来自 [AGENTS.md](../AGENTS.md) 与 [architecture.md](./architecture.md),Agent 化之后**仍然成立**:

- **对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。**
- **LLM 只观察(给离散信号),代码负责记账。** LLM 永不碰计数。新增的 Agent 编排能力,开放的是**编排**,不是数据库自由写入。
- `mastery_key` 跨句稳定——掌握系统的地基。
- 热路径只有 1 个 reply producer + N 个 observer,并行;其余 Agent 后台 / 按需。

## 现状 vs 计划:差距对照

| 计划概念 (CLAUDE.md) | 代码现状 | 差距 |
|---|---|---|
| `AgentDefinition` | `learning_agent` 表已有 `id/name/prompt/data_scope/version/allowed_tools/writeback_policy/output_schema/built_in`(`src/db/learning-agents.ts`) | 缺 `kind`、hook 绑定、`input_schema`、`uiAction`;只服务 lesson |
| `AgentHookBinding` | **无**;热路径在 `src/orchestrator.ts` `runTurn` 硬编码 `converse ∥ analyze` | 全新缝隙 |
| `agent_run` | `agent_job` 已有 `kind/status/in/out/error/source/时间戳` + `runTrackedAgentJob`(`src/db/agent-jobs.ts`) | 缺 `turn_id`/耗时/token;目前只 task-agent 用 |
| `agent_artifact` | `learning_project` 的 `plan_md/notes_md` 是特例 | 缺通用产物表(练习 / 报告 / 讲解) |
| `conversation_branch` | `conversation` 有 `kind/learning_agent_id/summary` | 缺 `parent/branch_source_turn/branch_kind/scenario_state/agent_modifiers` |
| `turn_annotation` | **无**;分析塞在 `turn.analysis_json` | 全新(让 observer 结果不污染主 turn) |
| `memory_proposal` | **无**;但 `src/data-edit.ts` 就是「LLM 提议有限 op → 代码校验 → 代码执行、不碰计数」的现成样板 | 缺待确认队列表 + UI |
| dataScopes 权限 | `LEARNING_DATA_SCOPE_VALUES` + `buildLearningDataContext`(`src/learning-data.ts`) | 已基本到位,扩展即可 |
| writeback 边界 | tutor:LLM 观察→`recordAnalysis` 记账;data-edit:LLM 提议→代码执行 | **铁律已落地**,推广即可 |
| 能力库 UI | `LearningAgentsView` + `LearningAgentEditDialog` | 只覆盖 lesson;缺 hook / 权限 / run 日志展示 |
| 自定义创建器 | `learning-agent-builder`(NL→draft) | 只生成 lesson;缺向导 + observer/action 类型 |
| Coach Panel | **无**;批改 / 讲解 / 双语在 `ChatView` 气泡内 | 全新右栏,迁移现有组件 |
| 会话状态条 + Action 按钮 | **无** | 全新 |

计划第十三节列的 8 张新表,真正「全新」的只有 `turn_annotation`、`memory_proposal`、`agent_artifact` 与 `conversation` 的分支列扩展;其余都是对现有 `learning_agent`/`agent_job`/`learning_project` 的泛化。

## 关键决策(反过度设计)

1. **运行时缝隙 ≠ DB 驱动绑定,拆开。** Phase 1 只做「把硬编码编排抽成 hook 派发 + 内置 agent 在**代码里**注册」——这是验收标准 #2/#3 的真正前提。DB 驱动的可启用 / 禁用 `agent_hook_binding` 推迟到 Phase 4(能力库 UI 真要消费时再建),否则是「为还没有的 UI 造配置表」。
2. **`learning_agent` → `agent_definition` 用加列演进,不做大爆炸改名 / 迁表。** Rust 迁移 append-only、已发布 21 个;计划第十三节本身批准「learning_agent 作为 `kind="lesson"` 特例保留」。等 Phase 4 真需要时再加 `kind/hook/enabled` 列。
3. **写入学习记忆只走两条既有代码路径**:tutor 的 `recordAnalysis`,或 data-edit 式的「提议→校验→执行」(Phase 5 的 `memory_proposal`)。**runtime 永不直接 `db.insert` mastery / key / provider。**

## 数据模型演进(按阶段)

| 表 / 变更 | 阶段 | 说明 |
|---|---|---|
| 泛化 `agent_job` → 加 `turn_id`(=`agent_run` 语义) | P1 | 每次运行可追踪;热路径异步落盘 |
| `conversation` 加 `parent_conversation_id / branch_source_turn_id / branch_kind / scenario_state_json / agent_modifiers_json`(migration v22) | P3 | 会话分支 |
| `learning_agent` 加 `kind / hook / enabled`(migration v27–v29) | P5 | 同一张表承载 lesson / observer / action |
| `turn_annotation` 表(migration v30) | P5 | observer 结果挂某轮,不污染主 turn |
| `memory_proposal` 表(migration v31) | P5 | 待确认的记忆写入队列 |
| `agent_artifact` 表 | 后续 | Agent 生成的独立练习 / 报告产物;当前 annotation/proposal 已覆盖 P5 |

> 迁移机制:定义在 Rust 侧 `src-tauri/src/lib.rs` 的 `add_migrations`,TS 侧 `src/db/schema.ts` 手动镜像,两边保持一致。

## 分阶段路线

每阶段:目标 → 改动 → 验证(挂到第十五节验收标准)→ 红线。

### Phase 1 — Agent Runtime 骨架(**行为不变的内部重构**)— ✅ 已完成
- **落地:** `src/runtime/`(`types` / `registry` / `builtins` / `index`)实现注册表 + `dispatchReply`(按 kind 取唯一 reply_producer)+ `dispatchObservers`(遍历 observer 并行触发)。`converse`/`runLearningAgent` 包成 reply_producer,`analyze`+`recordAnalysis` 包成 `builtin:tutor` observer(记账逻辑原样移入,不动 `deriveSignals→applySignal`)。`runTurn`/`runLearningTurn` 改为构造 `ConversationContext` + 经 runtime 派发;observer 用 `turnPersisted` barrier 在 turn 落库后才写回。日志:`agent_job` 加 `turn_id`(Rust migration v22 + `recordAgentRun`,`source="conversation"`,完成后 fire-and-forget 落库,不在 LLM 前插行)。测试 `src/runtime/registry.test.ts` 证明「新 observer 经公共 API 注册即被派发,无需改 runTurn」。**验证:** 109 个单测全绿、`biome + tsc` 干净、`cargo check` 通过。
- **目标:** 把 `runTurn` 里硬编码的 `converse ∥ analyze` 抽成 hook 派发;内置 agent 代码注册;延迟 / 记账 / 测试**零回退**。
- **改动:**
  - 新增 `src/runtime/`:`types.ts`(`AgentRunner`/`HookContext`/`HookName`)、`registry.ts`(代码内置注册表)、`run-hook.ts`。
  - `HookName` 先**只接线实际用到的两个**:`conversation.reply`(reply_producer)、`conversation.observe`(observer = 现 tutor)。其余 hook 名先定义为常量、不接线(YAGNI)。
  - `converse`/`runLearningAgent` 包成 reply_producer;`analyze` + `recordAnalysis` 包成 observer——**记账仍走原 `recordAnalysis`,只改「谁调用它」**,不碰 `deriveSignals→applySignal`。
  - `runTurn` 改成:按会话 kind 选 reply_producer 流式 + 并行触发 observers;**严格保留**「reply 先返回、analysis 后台、压缩不阻塞」时序。
  - `agent_run` 日志:泛化 `agent_job` 加 `turn_id`,热路径 **fire-and-forget 落盘**,绝不阻塞首 token。
- **验证:** 现有 vitest 全绿(尤其 `tutor.test`/`turns.test`/`mastery-logic.test`);手测首 token 不变(#1);**加一个 no-op observer、不改 `runTurn` 即生效**(#2);tutor 记账稳定(#8)。
- **红线:** 这是重构不是改产品。diff 应几乎全在新增 `runtime/` + `orchestrator.ts` 接线,不动 agent 内部 prompt。

### Phase 2 — Coach Panel 工作台 UI — ✅ 已完成(step 1:并存)
- **落地:** `.codex-shell` 栅格加第三列(`--codex-coach-width`,默认 340px;窄屏 `max-width:1024px` 改为从右侧浮出的抽屉,不挤压对话)。新增 [CoachPanel.tsx](../src/components/CoachPanel.tsx),分区 **本轮反馈**(批改中 / 纯文本降级 / 表达缺口 / 结构化纠错 + 朗读)与 **本轮学习记忆**(`deriveSignals(analysis)` 同源派生「系统记下了什么」+「查看全部学习数据」入口)。`App.tsx` 持有 `coachOpen`(localStorage 持久化,默认开)+ `coachTurn`,顶栏右侧加教练开关(仅普通练习对话出现;专项课/其它视图隐藏)。`ChatView` 仅加一个 `onActiveTurnChange` 回调把最新一轮上报(批改到达时自动重报)——**没动发送 / 重生成 / 从此处开始逻辑**。复用 `InlineCorrection` 的类别/严重度标签常量,零渲染漂移。**验证:** 109 单测全绿、`biome + tsc` 干净、`vite build` 通过。
- **本阶段范围(刻意):** 走计划的 step 1「并存」——Coach Panel 与气泡内反馈同时存在,气泡的批改/讲解/双语逻辑原样保留;step 2「把 InlineCorrection/ReplyExplanation 逐步搬进 Coach、给气泡瘦身」留待后续。顶部「会话状态条」与「下一步动作按钮」属 Phase 3(`conversation.action`),本阶段未做。
- **目标:** 右栏承接批改 / 更自然说法 / 讲解 / 记忆写入 / 下一步;中间保留 Conversation Stage;顶部状态条。
- **改动:**
  - `src/App.tsx` main 区由单列→三栏(左 Sidebar 已有 / 中 ChatView / 右 `CoachPanel`);窄屏 Coach 降级为底部抽屉。
  - 新增 `src/components/CoachPanel.tsx`,分区:本轮反馈 / 学习记忆 / 下一步。
  - 提升「当前聚焦 turn」状态(ChatView ↔ CoachPanel)。**分两步**:先让 Coach 读现有 `turn.analysis` 并存展示,再把 `InlineCorrection`/`ReplyExplanation` 逐步搬过去。
- **验证:** 批改 / 讲解 / 双语在右栏可用不回退;#6(用户看得见记住了什么)初步成立。
- **红线:** `ChatView` 822 行、状态多(streaming/turnGen/retry/截断)。**只搬「反馈展示」,绝不动发送 / 重生成 / 从此处开始的逻辑**——最易「顺手改」翻车处。

### Phase 3 — 会话动作 Agent + 分支 — ✅ 已完成
- **落地:**
  - **数据模型:** `conversation` 加 `parent_conversation_id / branch_source_turn_id / branch_kind / agent_modifiers_json`(Rust migration v23–v26 + TS 镜像)。`createBranch()`(`db/conversations.ts`)非破坏式派生新会话,可 `copyTurns: all | none | {upToTurnId}`(复制的 turn 拿新 id、保留批改,不重跑导师 → 不碰 mastery)。
  - **action agent:** runtime 新增 `ActionAgent`(`scope: session|turn`)+ `conversation.action` hook + `registerAction/getActions/runAction`(带日志)。内置 6 个:从此处分支(turn)、重新开始 / 提高难度 / 降低难度 / 调换角色 / 第二天继续(session),都是「代码建分支 + 注入修饰符」,`run` 返回要跳转的新会话 id。
  - **修饰符注入:** `AgentModifiers`(难度增量 / 调换角色 / 第二天 / 自由 note)由 `formatModifierInstructions` 转成英文指令,经 `PracticeContext.agentModifiers` 进入对话回复的 `SESSION ADJUSTMENTS` 段(`runTurn` 与 `regenerateReply` 都注入,保持一致)。
  - **UI(注册表驱动 → #3):** ChatView 顶部加会话状态条(左:分支来源标签;右:`getActions("session")` 按钮),用户消息加 `getActions("turn")` 的「从此处分支」按钮;两者都遍历注册表,**新增动作无需再改 ChatView**。动作建好分支后经 `onNavigateConversation` 切过去。Sidebar 给分支会话加来源图标提示。**没动**发送 / 重生成 / 从此处开始(截断)逻辑。
  - **验证:** 110 单测全绿(+1 action 注册测试)、`biome + tsc` 干净、`vite build` + `cargo check` 通过。
- **本阶段范围(刻意):** 状态条做的是「分支来源 + 高频动作」,**未做**完整的场景/角色状态条(`scenario_state_json` + 场景导演 Agent,单列为后续能力);「第二天继续」携带全历史 + 修饰符,**未做** AI 主动开场(那是 LLM 型 action,后续再加);「变成专项课」已在 Phase 5 补齐;侧栏只给分支图标提示,**未做**完整 ├─ 树形嵌套。
- **目标:** 第二天继续 / 重新开始 / 从此处分支 / 调换角色 / 升降难度 = `conversation.action`,**创建分支而非破坏原会话**。
- **改动:**
  - Rust migration **v22** + TS 镜像:`conversation` 加分支列(见上表)。
  - `src/db/conversations.ts` 加 `createBranch()`;`Sidebar` 展示分支树;状态条读 `scenario_state_json`。
  - **多数 action 是「代码建分支 + 给 reply_producer 注入 modifier」,未必都要 LLM**;LLM 只在需要生成新场景设定时介入。
- **验证:** #7(动作建分支不破坏原会话);#3(加按钮类 agent 靠注册表 + Coach/状态条插槽,不改 ChatView 主结构)。
- **红线:** 分支(non-destructive)要和现有「从此处开始」(destructive 截断,`ChatView.editFromHere`)**并存且语义区分清楚**。

### Phase 4 — Agent 能力库 — ✅ 已完成
- **落地:** 新增 [AgentLibraryView](../src/components/AgentLibraryView.tsx)(侧栏「设置」菜单 → 能力库,`MainView` 加 `agents`)。按 kind 分组展示注册表里的内置 Agent,每个有 `AgentCard`(做什么 / 运行时机 / 读取 / 写入 / 能否禁用),并附运行日志(读 `agent_job`,显示 agentId·来源·状态·耗时·时间·错误)。**启用/禁用**:`runtime/enablement.ts`(localStorage + 内存缓存,热路径零额外查询),主回复 `canDisable:false`,导师/动作可关;`dispatchObservers` 跳过被禁用的 observer,并在「无启用 observer」时回调 `onAnalysis(null)` 清掉 UI 的「分析中」;ChatView 的动作条/按钮也按启用态过滤。按需讲解 / 双语阅读 / 划词解析作为不可关闭的 `transformer` 进入能力库,调用时经 `runTransformer` 记录 `agent_job`。catalog 由 `listAgentCatalog()` 读注册表 → **新增 Agent 自动出现在能力库**。
- **关键决策兑现:** 没有把代码内置 Agent 同步进 DB、也没做 `learning_agent → agent_definition` 大迁移——能力库的真相源就是内存注册表,启用态用 localStorage,**避免重复真相源**(Phase 1 的反过度设计承诺)。
- **验证:** #4(每次运行有日志 + 能力库可查)· #9 部分(每个 Agent 的 `写入` 在卡片显式可见,代码边界仍是 runtime 不直接写 mastery/key/provider;自定义 Agent 的强制校验留待 Phase 5)。111 单测全绿、`biome + tsc` 干净、`vite build` 通过。
- **本阶段范围(刻意):** 能力库列的是 Agent Runtime 的内置 Agent(对话/导师/动作/按需 transformer);专项课(`learning_agent`)仍在「创建专项课」页管理,未合并进来。transformer 只登记能力卡并复用运行日志,实际生成仍由 `orchestrator` 在用户点击/划词的调用点直接触发,不进入热路径派发。
- **目标:** 能力库页展示内置 + 启用 / 禁用 + 权限 / 时机 / 写入策略 + run 日志。
- **改动:** 此时才泛化 `learning_agent`(加 `kind/hook/enabled` 列,或独立 `agent_hook_binding` 表);把 P1 的代码内置 agents 登记进来(`built_in=1`);`LearningAgentsView` 升级为能力库 + run 日志视图;**启动时把 DB 绑定合并进内存注册表,每轮零查表**。
- **验证:** #4(每次运行有日志);#9(白名单 `allowed_tools`+`writeback_policy` + 代码执行边界,自定义不能改计数 / 密钥 / provider)。

### Phase 5 — 自定义 Agent(向导) — ✅ 已完成
- **落地:** `learning_agent` 增加 `kind / hook / enabled`(Rust migration v27–v29 + TS 镜像),`kind="lesson"` 继续服务专项课,`kind="observer" | "action"` 由 [custom-agents.ts](../src/runtime/custom-agents.ts) 动态加载进 runtime 注册表。能力库页新增 6 问式创建表单(名称 / 描述 / 类型 / 写入策略 / 数据 scope / prompt):observer 每轮普通练习后运行,输出经 Zod schema 校验后写 `turn_annotation`;若策略为 `propose_review_signals`,只能创建 `memory_proposal`。Coach Panel 新增「自定义观察」与「待确认记忆」区,用户确认后走 `applyDataEditOperations` 做 create/update/delete/status 的有限操作。action 点击后让 LLM 生成分支标题与会话指令,代码创建 `custom_action` 非破坏式分支并注入 modifier note。内置「变成专项课」action 读取当前会话,走 `learning-agent-builder` 生成专项课并创建 `learning_agent` 会话后跳转。
- **验证:** #5(写入前代码验证)由 `memory_proposal` + `applyDataEditOperations` 保证;#10 由能力库创建表单、Coach 待确认区、会话动作按钮保证。自定义 Agent 仍只允许 prompt/schema 型,不开放任意代码执行。
- **目标:** 向导 6 问创建 prompt 型 observer/action;output schema 校验。
- **改动:** 能力库表单直接创建 prompt 型 runtime agent;observer 输出走 **`turn_annotation`** 展示;写入走 **`memory_proposal`**(新表 + Coach Panel「待确认」区,确认即走 data-edit 式代码执行)。自然语言通用 agent-builder 留到需要更复杂向导时再做,避免为 UI 未消费的生成器扩展 scope。
- **验证:** #5(写入前代码验证);#10(用户感知是学习动作)。
- **红线:** 最易过度设计。第一版**严格限定 prompt/schema 型,不开放任意代码执行**(计划第十一节)。

### Phase 6 — 开发者 package — ✅ 已完成
- **落地:** 新增 [agent-package.ts](../src/agent-package.ts),定义 `lang-agent.agent-package` v1 JSON 包:agent 元数据 + `prompt.md` + `schema.json` + `examples.json`。能力库中自定义 Agent 可「导出包」,包文本可粘贴导入;导入前 `reviewAgentPackage` 展示读取 scope 与写入策略,并用 Zod 校验 kind/hook/scope/tool/writeback 白名单。导入后创建为启用的自定义 observer/action 并刷新 runtime 注册表。
- **验证:** `agent-package.test.ts` 覆盖权限摘要与非法 tool 拒绝;113 单测全绿、`biome + tsc` 干净、`vite build` + `cargo check` 通过。文件包当前用 JSON 承载多个逻辑文件,未引入 zip / 文件系统依赖。

## 贯穿全程的铁律
- **写入边界:** 见关键决策 #3。runtime 永不直接写 mastery / key / provider。
- **热路径预算:** observer 并行;`agent_run` 异步落盘;DB 绑定启动载入内存,每轮零查表。守住 #1。
- **三处同步:** prompt 在 `docs/*` 与 `src/agents/*.ts` 各一份,schema 在 Zod 与 drizzle 各一份;改一处同步另一处。
- **测试节奏:** 每阶段先保证现有 vitest 全绿,再加 runtime 注册表 / hook 派发单测;tutor `mastery_key` 跨句稳定性保留人测。

## 验收标准 → 责任阶段

| # | 验收标准(CLAUDE.md 第十五节) | 主要由谁保证 |
|---|---|---|
| 1 | 普通聊天首 token 不明显变慢 | P1(并行 + 异步落盘) |
| 2 | 加 observer 不改 `runTurn` | P1 |
| 3 | 加按钮类 agent 不改 ChatView 主结构 | P2 插槽 + P3 注册表 |
| 4 | 每次 Agent 运行有日志 | P1(agent_run)+ P4(日志 UI) |
| 5 | 写入学习记忆前有代码验证 | P5(memory_proposal) |
| 6 | 用户能看到系统记住了什么 | P2(Coach Panel) |
| 7 | 第二天继续 / 调换角色 / 更高难度 = 分支 | P3 |
| 8 | Tutor mastery 记账稳定 | P1(不动记账逻辑) |
| 9 | 自定义 agent 不能改计数 / 密钥 / provider | P4 白名单 + P5 执行边界 |
| 10 | UI 上是学习动作,不是技术 hook | P2/P3/P5 |

## 起步点

**Phase 1 的最小垂直切片**:抽出 hook 缝隙 + 内置 agent 代码注册 + `agent_run` 日志,然后用**一个 no-op observer 在不碰 `runTurn` 的前提下注册成功**来证明验收 #2/#8。这一刀风险最低(纯重构、行为不变),却直接验证整个架构方向是否成立——成了再往 UI 走。
