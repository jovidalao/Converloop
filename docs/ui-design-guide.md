# UI Design Guide

本指南承接 [craft-ui-plan.md](./craft-ui-plan.md),聚焦当前最容易漂移的两件事:文字大小和文字颜色。目标不是照搬 craft-agent,而是把 lang-agent 收敛成紧凑、低噪声、可长期维护的桌面学习工作台。

## 参考

参照 `craft-agents-oss-main/apps/electron/src/renderer/index.css` 与 `craft-agents-oss-main/packages/ui/src/styles/index.css`:

- 根字号使用 `15px`,让 Tailwind 的 `text-xs / text-sm / text-base` 自然落到约 `11 / 13 / 15px`。
- 常规界面文字以 13px 为主,页面/弹窗标题约 16px,聊天正文约 15px。
- 颜色从 6 个基色派生:`background / foreground / brand / info / success / destructive`。
- 灰度文字使用 `foreground-*` 混合色,不要再叠多套中性灰或随手加透明度。

## 字号

统一 token 定义在 `src/index.css`:

| 用途 | 工具类 | 大小 | 说明 |
|---|---:|---:|---|
| 极小计数 | `text-ui-micro` | 10px | tab 计数、极短数字 |
| 快捷键 / badge | `text-ui-caption` | 11px | kbd、状态 badge、很短的元信息 |
| 次级元信息 | `text-ui-meta` | 12px | 菜单右侧说明、工具按钮辅助文本 |
| 默认 UI | `text-ui-body` / `text-sm` | 13px | 表单、菜单、设置、列表、Coach |
| 聊天正文 | `text-ui-chat` / `text-base` | 15px | 用户气泡、输入框、主要回复 |
| 页面标题 | `text-ui-title` | 16px | 页面标题、弹窗标题、错误标题 |

规则:

- 新增 UI 默认用 `text-ui-body`;不要为了“更明显”随手用 `text-base`。
- 聊天 stage 的可阅读正文才用 `text-ui-chat`。
- 页面标题只用 `text-ui-title`;避免 `text-xl` 以上的营销式层级。
- 需要更小文字时优先用 `text-ui-meta` 或 `text-ui-caption`,不要写新的 `text-[11px]` / `text-[0.7rem]`。

## 颜色

文字颜色按信息层级选择:

| 层级 | 工具类 / token | 说明 |
|---|---|---|
| 主文本 | `text-foreground` | 正文、标题、当前选中项 |
| 次级文本 | `text-ui-secondary` / `text-foreground-80` | 正在流式的回复、次要但仍需读的文字 |
| 弱文本 | `text-ui-muted` / `text-foreground-70` | 说明、元信息、空状态 |
| 最弱文本 | `text-ui-subtle` / `text-foreground-60` | kbd hint、右侧辅助短说明 |
| 主动作 | `text-primary` / `bg-primary` | 主按钮、AI/教练相关主动作 |
| 信息/待确认 | `text-info` / `text-info-text` | 表达缺口、待确认、提醒 |
| 成功 | `text-success` / `text-success-text` | 用对了、已掌握、完成 |
| 错误 | `text-destructive` / `text-destructive-text` | 错误、删除、失败 |

规则:

- 不在组件里写新的 hex / oklch / rgba 文字色。品牌 logo 也优先映射到语义色。
- 避免 `text-muted-foreground/70`、`opacity-70` 这类叠加透明度;用 `text-ui-muted` 或 `text-ui-subtle`。
- `muted-foreground` 保留给 shadcn 兼容,它等价于 `foreground-50`。
- chrome / sidebar / coach 的文字必须从 `foreground-*` 派生,不再维护单独灰阶。
- 侧栏、顶部栏、主要工具按钮默认用实色文字/图标;hover 只加低透明背景,不要靠“浅灰变黑”表达可交互。
- 禁用态才用透明度降级;不要把可点击项默认做成浅灰。
- focus ring 使用 `--ring` 的中性 1px 前景色环;不要使用系统强调色或品牌色做大面积选框。
- selected/active 面优先使用 `bg-accent` / `bg-foreground-*` 这类中性面,避免紫色边框式选中态。
- 左右侧栏 resizer 只有 1px 可见线,hit area 可以略宽;滚动条要细、浅、低存在感。
- 定制化学习的子项必须缩进,让父子包含关系一眼可见。

## 验收

改 UI 后至少做三项检查:

1. `rg "text-\\[#|text-muted-foreground/|text-\\[11px\\]|text-\\[0\\.7rem\\]|text-lg|text-xl" src`
2. 运行 `pnpm check`。
3. 看普通聊天、Coach 打开、设置/数据/能力库页,确认标题、正文、说明、badge 有稳定层级。
