# UI 指南(Craft 风格工作台)

lang-agent 的界面目标:把「聊天 + 侧边栏 + Coach Panel」打磨成 **Craft 风格的语言学习工作台**——低噪声、强层级、渐进披露、精密微交互、键盘优先。参照 `craft-agents-oss-main`(`apps/electron/src/renderer/index.css`、`packages/ui/src/styles/index.css`),但学的是它的设计纪律,不是照搬通用 agent IDE。

## 现状

Craft 化改造(原 `craft-ui-plan.md` 的 Phase 0–7)已落地:6 色语义 token + 混合层级 + shadow/z-index/panel radius;`EntityRow`/`EntitySection` 与丝滑 Sidebar;`TurnCard` + 活动折叠 + 思考指示 + 滚动渐变遮罩;输入区控制台 + active option badges + `/` 命令菜单;`AnnotationIsland` 选区浮岛;Coach Inspector tab 化;全局快捷键(`Cmd+1/2/3` 聚焦 panel)+ 快捷键弹窗 + 带耗时的 processing indicator。

**后续只做持续视觉 QA 与小步打磨**,不再新增独立计划。下面是设计纪律(改 UI 时遵守)+ 文字/颜色规范(最易漂移,务必照做)。

## 不可破坏的边界

- 不改学习系统铁律:对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD([architecture](./architecture.md))。
- 不把 LLM 变成数据库写入者;记忆写入仍走 Tutor 记账或 `memory_proposal` 确认流程。
- 不为了界面重写 provider / orchestrator / runtime 主链路。
- 不引入 Electron / 远程 server / 通用 MCP 市场。

## Craft 的设计纪律(可直接复用)

1. **设计令牌系统** — 高级感来自 6 个语义基色(`background / foreground / accent / info / success / destructive`),其余层级用 `color-mix` 派生(`/N` 透明色做边框/hover/遮罩;`-N` 向背景混合的实色做分隔线/弱面板)。保留学习语义:success=说对/已掌握,info=表达缺口/待确认,accent=AI 教练/主能力。
2. **Panel Shell** — 桌面感来自固定 panel 规则:panel 间距 6px、窗口边缘 inset 6px、外圆角大于内圆角、resize hit area 与可见分割线分离;顶栏/侧栏/主内容/右栏服从同一套 layout constants。
3. **EntityRow 列表原语** — 会话/专项课/能力/学习项目共享一套行:图标槽 + 标题 + suffix + badges + trailing + 右键菜单 + 状态指示;低频操作 hover 才显示。
4. **丝滑侧边栏** — 13px 字号、14px 图标、6px 圆角、紧密列表;分组展开用 ~200ms height/opacity 动画;嵌套项用淡竖线表达层级;定制化学习子项必须缩进。
5. **Turn Card + 渐进披露** — 一轮 = 用户输入 + Conversation 回复 + Tutor 批改 + 系统记忆信号 + 自定义 observer 注释 + 按需动作。默认只显示自然回复;批改/记忆/活动进可展开行或右侧 Coach,中间区保持轻。新增 observer 只新增 activity,不改 ChatView 主结构。
6. **思考过程 UI** — 是状态机不是裸推理:`pending / tool_active / awaiting / streaming / complete`。只显示可观察工作状态(「正在批改」「正在整理记忆」),不暴露 chain-of-thought;回复加轻量 buffering 避免半句抖动;任务结束但回复未到时保留 awaiting,不让 UI 突然空掉。
7. **输入区控制台** — 输入框上方显示 active option badges(模式/难度/角色/专项课/复习上下文);`/` 承接 slash commands(键盘优先);structured prompt 用输入区内嵌状态,少用突兀 modal;高度变化有动画,不挤压聊天造成跳动。
8. **选区浮岛** — 划词学习的高频微交互:选中目标语→翻译/讲解/朗读/加入生词;用 selection state machine 管理选区,ESC/点击外部/滚动/resize 行为一致,移动端退化为底部操作条。
9. **微交互与键盘优先** — 所有动作来自统一 action registry(命令面板/按钮/菜单/快捷键同源,可显示 hotkey);`Cmd+1/2/3` 聚焦 panel,`Cmd+K` 命令面板;processing indicator 显示克制的状态文案 + 耗时;hover/focus/selected/menu-open/disabled 状态全局一致。

## 字号

统一 token 定义在 `src/index.css`;根字号 15px,让 `text-xs/sm/base` 落到约 11/13/15px。

| 用途 | 工具类 | 大小 | 说明 |
|---|---:|---:|---|
| 极小计数 | `text-ui-micro` | 10px | tab 计数、极短数字 |
| 快捷键 / badge | `text-ui-caption` | 11px | kbd、状态 badge、很短的元信息 |
| 次级元信息 | `text-ui-meta` | 12px | 菜单右侧说明、工具按钮辅助文本 |
| 默认 UI | `text-ui-body` / `text-sm` | 13px | 表单、菜单、设置、列表、Coach |
| 聊天正文 | `text-ui-chat` / `text-base` | 15px | 用户气泡、输入框、主要回复 |
| 页面标题 | `text-ui-title` | 16px | 页面标题、弹窗标题、错误标题 |

- 新增 UI 默认用 `text-ui-body`;别为了「更明显」随手用 `text-base`。
- 只有聊天 stage 的可阅读正文用 `text-ui-chat`;页面标题只用 `text-ui-title`,避免 `text-xl` 以上的营销式层级。
- 需要更小文字优先 `text-ui-meta` / `text-ui-caption`,不要写新的 `text-[11px]` / `text-[0.7rem]`。

## 颜色

文字颜色按信息层级选择:

| 层级 | 工具类 / token | 说明 |
|---|---|---|
| 主文本 | `text-foreground` | 正文、标题、当前选中项 |
| 次级文本 | `text-ui-secondary` / `text-foreground-80` | 正在流式的回复、次要但仍需读 |
| 弱文本 | `text-ui-muted` / `text-foreground-70` | 说明、元信息、空状态 |
| 最弱文本 | `text-ui-subtle` / `text-foreground-60` | kbd hint、右侧辅助短说明 |
| 主动作 | `text-primary` / `bg-primary` | 主按钮、AI/教练相关主动作 |
| 信息/待确认 | `text-info` / `text-info-text` | 表达缺口、待确认、提醒 |
| 成功 | `text-success` / `text-success-text` | 用对了、已掌握、完成 |
| 错误 | `text-destructive` / `text-destructive-text` | 错误、删除、失败 |

- 不在组件里写新的 hex / oklch / rgba 文字色;品牌 logo 也优先映射到语义色。
- 避免 `text-muted-foreground/70`、`opacity-70` 这类叠加透明度;用 `text-ui-muted` / `text-ui-subtle`。`muted-foreground` 保留给 shadcn 兼容,等价于 `foreground-50`。
- 侧栏/顶栏/主要工具按钮默认用实色文字/图标;hover 只加低透明背景,不靠「浅灰变黑」表达可交互。禁用态才用透明度降级。
- focus ring 用 `--ring` 的中性 1px 前景色环;selected/active 面优先 `bg-accent` / `bg-foreground-*` 这类中性面,避免紫色边框式选中态。
- 左右侧栏 resizer 只有 1px 可见线(hit area 可略宽);滚动条要细、浅、低存在感。

## 验收

改 UI 后至少做三项检查:

1. `rg "text-\[#|text-muted-foreground/|text-\[11px\]|text-\[0\.7rem\]|text-lg|text-xl" src`
2. `pnpm check`
3. 看普通聊天、Coach 打开、设置/数据/能力库页,确认标题、正文、说明、badge 有稳定层级,无重叠/溢出/突兀默认组件。
