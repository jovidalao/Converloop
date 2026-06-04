# Craft UI/UX 改进计划

本计划替代旧的 `agent-runtime-plan.md`。旧计划里的 Agent Runtime、Coach Panel、会话分支、能力库、自定义 Agent 和 package 能力已经落地或沉淀到现有架构文档中;后续路线不再是继续扩 runtime,而是学习 `craft-agents-oss-main` 的交互设计和界面设计,把 lang-agent 打磨成更高级、更顺滑的语言学习工作台。

## 目标

把当前「聊天 + 侧边栏 + Coach Panel」升级为 **Craft 风格的语言学习工作台**:

- 左侧是学习 inbox,管理会话、专项课、能力、复习状态。
- 中间是 conversation stage,自然对话仍是主体验。
- 右侧是 coach inspector,承接批改、记忆、解释和本轮运行细节。
- 输入区成为控制台,能显式选择上下文、模式、专项课和动作。

核心不是照搬 craft 的通用 agent IDE,而是学习它的设计纪律:低噪声、强层级、渐进披露、精密微交互、键盘优先。

## 当前实现状态

截至 2026-06-04,Phase 1-7 已落地:

- Phase 1:Craft 式 6 色语义 token、混合层级、shadow / z-index / panel radius。
- Phase 2:`EntityRow` / `EntitySection` 与丝滑 Sidebar。
- Phase 3:`TurnCard`、`lib/turn-activity.ts`、活动折叠行、思考指示与滚动渐变遮罩。
- Phase 4:输入区控制台、active option badges、`@` 学习上下文菜单与 `/` 菜单统一。
- Phase 5:`AnnotationIsland` 选区浮岛,支持解析、朗读、加入生词,并保留选区。
- Phase 6:Coach Inspector tab 化,对齐本轮反馈、学习记忆、自定义观察、待确认记忆。
- Phase 7:全局快捷键元数据、`Cmd+1/2/3` 聚焦 panel、快捷键弹窗、带耗时的 processing indicator。

后续只做持续视觉 QA 与小步打磨,不再新增一条独立旧计划。

## 不可破坏的边界

- 不改学习系统铁律:对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。
- 不把 LLM 变成数据库写入者;记忆写入仍走 Tutor 记账或 `memory_proposal` 确认流程。
- 不为了界面重写 provider、orchestrator、runtime 主链路。
- 不引入 Electron / 远程 server / 通用 MCP 市场作为当前目标。

## Craft 值得直接学习的实践

### 1. 设计令牌系统

craft 的高级感来自 6 个语义基色:

- `background`:底色
- `foreground`:文本与图标
- `accent`:品牌/主动作
- `info`:提示、待确认、表达缺口
- `success`:说对、已掌握、完成
- `destructive`:错误、失败、删除

其余层级用 `color-mix` 派生:

- `/N` 透明色:边框、hover、遮罩、轻背景。
- `-N` 向背景混合的实色:分隔线、弱面板、模式底色。

要迁移到 lang-agent:

- 用 craft 式 6 色系统替换当前 stock shadcn 灰阶 token。
- 增加 `--shadow-minimal`、`--shadow-minimal-flat`、`--shadow-modal-small`、`shadow-tinted`。
- 用 `@property` 注册核心颜色变量,为主题切换和 hover preview 留出动画能力。
- 保留学习语义:success=说对/已掌握,info=表达缺口/待确认,accent=AI 教练/主能力。

验收:

- 新 UI 不再像默认 shadcn 模板。
- 页面颜色主要来自 6 个语义 token,组件里不散落临时色值。
- light/dark 模式都有明确视觉层级。

### 2. Panel Shell

craft 的桌面感来自固定的 panel 规则:

- panel 间距 6px。
- 窗口边缘 inset 6px。
- 外边缘圆角大于内部圆角。
- resize hit area 和可见分割线分离。
- 顶栏、侧栏、主内容、右栏都服从同一套 layout constants。

要迁移到 lang-agent:

- 抽 `src/components/layout/*` 或 `src/lib/layout.ts`,集中定义 shell、panel、chat 宽度、gap、radius、sash。
- 当前 `.codex-shell` 改成真正的 panel workbench,减少硬编码 CSS 变量散落。
- Chat 区增加 craft 的上下渐变遮罩,滚动边缘不要硬切。

验收:

- Sidebar / Chat / Coach 的边界、圆角、间距一致。
- 拖拽侧栏或 Coach 时不卡顿,resize 区域好点中。
- 窄屏降级为抽屉时不破坏主对话。

### 3. EntityRow 通用列表原语

craft 的 sessions / sources / skills / automations 看起来统一,因为它们共享 EntityRow:图标槽、标题、suffix、badges、trailing、右键菜单、状态指示。

要迁移到 lang-agent:

- 新增 `EntityRow` / `EntityList` 原语。
- 会话列表、专项课列表、能力库列表、学习项目列表逐步共用。
- 行内状态槽支持:批改中、未读、待确认记忆、衍生来源、专项课类型。
- trailing 槽按优先级显示:搜索命中 > 标记 > 相对时间。
- hover 时才显示低频操作,默认保持干净。

验收:

- `Sidebar.tsx` 不再包含一整套会话专用 row 逻辑。
- 会话 / 能力 / 专项课的行高、图标、badge、hover 行为一致。
- 右键菜单与键盘焦点状态视觉一致。

### 4. 丝滑侧边栏

craft 侧边栏的关键参数:

- 13px 字号。
- 14px 图标。
- 6px 圆角。
- `gap-0.5` 的紧密列表。
- 子项展开用高度动画。
- 嵌套项用淡竖线表达层级。
- badge / 数量 / 子操作 hover reveal。

要迁移到 lang-agent:

- 将侧边栏改为 Learning Inbox:新对话、练习中、待复盘、专项课、学习项目、能力库、归档。
- 分组展开时使用 200ms 左右的 height/opacity 动画。
- 子项进入时加轻微 stagger,避免突兀展开。
- 衍生会话在来源会话下可折叠展示,先做一层即可。

验收:

- 侧边栏滚动、展开、hover 都轻量顺滑。
- 默认状态信息密度高但不拥挤。
- 不通过大面积卡片或强边框制造层级。

### 5. Turn Card + 渐进披露

craft 不把 agent 过程散成多条消息,而是按 turn 分组。assistant turn 包含回复正文、活动列表、状态、操作菜单。活动默认折叠,需要时展开。

lang-agent 的一轮应表达为:

- 用户输入。
- Conversation 回复。
- Tutor 批改。
- 系统记忆信号。
- 自定义 observer 注释。
- 推荐回复 / 讲解 / 双语 / TTS 等按需动作。

要迁移到 lang-agent:

- 新增 `TurnCard` 适配层,先读取现有 `turn`、`agent_job`、`turn_annotation`、`memory_proposal`。
- 默认只显示自然对话回复;活动、批改、记忆写入进入可展开行或右侧 Coach。
- 气泡下方的重复反馈逐步下沉到 Coach,中间区保持轻。
- `CHAT_LAYOUT` 常量集中管理最大宽度、padding、message spacing。

验收:

- 用户能看懂一轮里发生了什么,但默认不会被细节压住。
- 新增 observer 只新增 activity,不改 ChatView 主结构。
- 现有发送、重生成、从此处开始、分支语义不回退。

### 6. 思考过程 UI

craft 的 thinking UI 本质是状态机,不是展示裸推理。它区分:

- `pending`:还没有活动。
- `tool_active`:有任务正在跑。
- `awaiting`:任务结束,等待下一步。
- `streaming`:最终回复流式中。
- `complete`:本轮完成。

还使用回复缓冲策略:首批 token 不立刻展示,等内容达到结构阈值或超时后再显示,避免半句话抖动。

要迁移到 lang-agent:

- 定义语言学习版 activity 状态:reply、tutor、memory、explain、suggestion、tts、maintainer。
- 不显示模型隐式推理;只显示可观察的工作状态,如「正在批改」「正在整理记忆」「正在生成讲解」。
- 对流式回复加轻量 buffering:短时间内先显示 `Thinking...` 或 `Preparing response...`。
- 工具/活动结束但回复未到时保留 awaiting 状态,避免 UI 突然空掉。

验收:

- 批改慢于回复时,UI 有稳定状态,不闪烁。
- Tutor / 自定义 observer / 讲解等异步任务都有可见生命周期。
- 不把 chain-of-thought 暴露给用户。

### 7. 输入区控制台

craft 的输入区不是普通 textarea,而是一个带工具条的控制台:权限模式、模型、附件、source、skill、slash command 都贴着输入框。

要迁移到 lang-agent:

- 输入框上方显示 active option badges:当前模式、难度、角色、专项课、复习上下文。
- `@` 唤起上下文菜单:弱项、今日复习、表达缺口、专项课、学习项目、能力。
- `/` 继续承接 slash commands,但视觉上与 `@` 菜单统一。
- 会话调节如难度、角色、场景不只藏在顶栏「衍生新对话」里,也能成为输入区 badge。
- structured prompt 用输入区内嵌状态承接,少用突兀 modal。

验收:

- 用户一眼知道本轮输入会带哪些学习上下文。
- `@` 和 `/` 的菜单可键盘操作。
- 输入区高度变化有动画,不会挤压聊天造成跳动。

### 8. 选区浮岛

craft 的 annotation island 是高频微交互:选中文本后出现浮岛菜单,有交互状态机、入场动效、选区恢复、tooltip-only / interactive 模式。

lang-agent 最适合迁移到划词学习:

- 选中目标语文本 -> 翻译、讲解、朗读、加入生词、用它造句。
- 选中用户错误片段 -> 解释这个错误、练 3 句、标记为已懂。
- 选中 AI 回复 -> 推荐我怎么接、转成双语、收藏表达。

要迁移到 lang-agent:

- 用 `AnnotationIsland` 替换或升级现有 `TranslationPopover`。
- 加 selection state machine,避免弹层闪烁、选区丢失。
- 第一版只接 3 个动作:翻译、讲解、朗读;再加「加入生词」。

验收:

- 划词浮岛位置稳定,滚动/点击外部/ESC 行为一致。
- 选区不会因打开菜单而丢失。
- 移动端退化为底部操作条。

### 9. 微交互与键盘优先

craft 的精致感来自很多一致的小动作:

- shimmmer / cycling processing message。
- 可坍缩状态槽。
- modifier-click 语义。
- `Cmd+1/2/3` 聚焦 panel。
- `Cmd+K` 命令面板。
- `Shift+Tab` 循环模式。
- 所有动作来自 action registry,并能显示 hotkey。

要迁移到 lang-agent:

- 统一 action registry:命令面板、按钮、菜单、快捷键都从同一份定义读。
- 增加 `Cmd+1/2/3`:聚焦侧栏、聊天、Coach。
- 增加快捷键弹窗。
- 长任务用 processing indicator 显示随机但克制的状态文案和耗时。
- hover / focus / selected / context-menu-open 状态全部视觉一致。

验收:

- 常用操作不需要鼠标。
- 菜单项、命令面板、快捷键文案不会漂移。
- loading 状态有生命感但不喧宾夺主。

## 分阶段执行

### Phase 0 - 设计基线与截图审计

目标:先建立可比较的视觉基线。

改动:

- 为当前主要视图截图:普通聊天、Coach 打开、Sidebar 展开、能力库、设置页。
- 记录当前主要 CSS token、常用字号、行高、radius、阴影、panel gap。
- 建立 `docs/ui-screenshots/` 或测试输出目录,用于后续视觉对比。

验证:

- 后续每阶段都能拿截图对比,不是凭感觉说「高级」。

### Phase 1 - Craft 式设计令牌

目标:先解决「默认模板感」。

改动:

- 重写 `src/index.css` 的核心 token 为 6 色系统。
- 加 `foreground-*` 混合层级和 shadow token。
- 补 z-index scale、panel radius、chat layout constants。
- 调整 button、input、popover、card 的默认视觉,减少 stock shadcn 味道。

验证:

- 页面无需改业务组件,整体质感已有明显变化。
- light/dark 模式都可用。
- `pnpm check`、`pnpm build` 通过。

### Phase 2 - EntityRow 与丝滑 Sidebar

目标:让左侧成为 craft 风格 Learning Inbox。

改动:

- 新增 `EntityRow` / `EntityList`。
- 重写 Sidebar 会话行,使用统一图标槽、状态槽、title、suffix、trailing、badges。
- 加分组、归档、待复盘、专项课入口的统一 row。
- 加展开动画、hover reveal、右键菜单视觉统一。

验证:

- 会话选择、新建、重命名、删除、衍生动作全部保留。
- 侧栏展开/收起、分组展开没有 layout jump。

### Phase 3 - Conversation Stage 与 Turn Card

目标:中间区从消息列表升级为 turn-based conversation stage。

改动:

- 抽 `TurnCard` 与 activity adapter。
- 将 Tutor、memory signals、自定义 annotation、proposal 映射为 activity。
- 增加折叠活动行、step count、preview text、thinking indicator。
- 聊天滚动区使用渐变 mask。
- 保留原 ChatView 发送状态,先做渲染层替换,不碰 orchestrator。

验证:

- 普通对话、专项课、离档轮、重生成、从此处开始都可用。
- 批改晚到时 activity 更新稳定。

### Phase 4 - 输入区控制台

目标:把控制项收回输入区。

改动:

- 输入区上方加 active option badges。
- `@` 菜单接学习上下文、专项课、能力。
- `/` 菜单视觉统一。
- 将难度、角色、场景、复习上下文做成可见 badge。
- 输入区 height transition 和 structured state 统一。

验证:

- 用户可以只用键盘选择上下文并发送。
- 现有 slash 行为不回退。

### Phase 5 - Annotation Island

目标:把划词做成核心学习微交互。

改动:

- 用 selection state machine 管理选区。
- 替换 `TranslationPopover` 为浮岛式菜单。
- 首批动作:翻译、讲解、朗读、加入生词。
- Coach 可显示浮岛动作结果。

验证:

- 选区稳定,浮岛不遮挡文本。
- ESC、点击外部、滚动、窗口 resize 行为一致。

### Phase 6 - Coach Inspector 精修

目标:右栏从「信息面板」变成真正 inspector。

改动:

- Coach 分区视觉与 TurnCard activity 对齐。
- 当前 turn、当前 activity、待确认记忆之间可切换。
- 批改、表达缺口、记忆写入统一用低噪声卡片。
- 删除中间区重复批改展示,只保留必要入口。

验证:

- 用户能清楚看到「本轮错在哪」「系统记住了什么」「哪些写入待确认」。
- 不再出现中间和右栏重复展示同一大段反馈。

### Phase 7 - 微交互、快捷键、视觉 QA

目标:收尾到 craft 的顺滑程度。

改动:

- 统一 action registry,给按钮、菜单、命令面板、快捷键同源。
- 增加 `Cmd+1/2/3` 聚焦 panel 和快捷键弹窗。
- processing indicator 加 elapsed time 和轻量文案轮换。
- 对 hover、focus、selected、menu-open、disabled 做全局一致性修正。
- 用 Playwright 或浏览器截图覆盖桌面/窄屏主要状态。

验证:

- 主要路径可键盘完成。
- 截图检查无重叠、无溢出、无突兀默认组件。

## 总体验收标准

- UI 第一眼不再像默认 shadcn 模板,有明确品牌 accent 和层级系统。
- Sidebar 丝滑、紧凑、可扫读,会话状态一眼可见。
- 中间区保持自然对话,细节通过 TurnCard 和 Coach 渐进披露。
- 思考/批改/记忆写入有稳定状态,不闪烁、不空白。
- 输入框能表达本轮上下文和模式,而不只是 textarea。
- 划词交互成为高频学习入口。
- 所有改动不破坏现有学习记账和热路径延迟。

## 起步点

最小垂直切片:

1. 先做 Phase 1 的设计 token。
2. 再做 Phase 2 的 `EntityRow` + Sidebar。
3. 然后做 Phase 3 的 TurnCard activity 外壳。

这三步最能快速接近 craft 的界面气质,同时不会碰核心学习链路。
