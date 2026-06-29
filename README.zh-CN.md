# Converloop

[English](README.md) | 简体中文

> **对话。纠错。记住。循环。** 一个面向 macOS 和 Windows 的本地优先 AI 语言导师：它和你对话、就在你刚写的句子上纠错、记住每一个表达缺口，于是下一次练习已经知道该往哪里走。

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-2337ff.svg)](LICENSE)
[![Platform: macOS | Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-555.svg)](#快速开始)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-24c8db.svg)](https://tauri.app)

**[官网](https://jovidalao.com/converloop)** · **[源码仓库](https://github.com/jovidalao/Converloop)** · **[反馈问题](https://github.com/jovidalao/Converloop/issues)** · **[许可证](LICENSE)**

Converloop 是一个本地优先的 AI 语言学习桌面端,面向希望练习能持续积累的学习者。它把真实对话、即时批改、长期学习记忆、语音练习和专项训练放在同一个 Tauri 应用里,默认使用用户自己的模型 API key。

你用目标语言说或写一句话后,Converloop 会先返回自然的流式回复,同时并行生成结构化反馈。系统在本地记录错误、正确使用、表达缺口和复习证据,再把这些学习状态带回后续对话、专项课、听力练习和训练任务。

## 截图

真实产品截图准备好后放到 `docs/screenshots/`。README 已经预留了主叙事对应的图片位：

<!--
<p align="center">
  <img alt="Converloop 对话与行内纠错" src="docs/screenshots/conversation.png" width="880">
</p>

<p align="center">
  <img alt="Converloop Coach Panel 与学习记忆" src="docs/screenshots/coach-panel.png" width="880">
</p>

<p align="center">
  <img alt="Converloop 训练中心" src="docs/screenshots/practice-center.png" width="880">
</p>
-->

## 为什么是 Converloop

- **对话优先。** 应用先回应你想表达的意思,再开始教学,所以练习仍然像聊天。
- **纠错贴着原句。** 你能看到错误片段、完整改正版、更自然说法和放在上下文里的语法说明。
- **记忆基于证据。** 错误、说对的地方和表达缺口都会变成本地记录,不是模糊的“AI 记忆”。
- **复习回到语境里。** 薄弱点会进入之后的对话、专项课、听写和训练,而不是只待在抽认卡队列里。
- **本地数据归你。** 对话、档案、学习数据、设置和备份都在本机;密钥不会进入备份。

## 学习闭环

Converloop 把大多数工具止步于「回复」的那个环闭上——每一轮都喂给一份学习状态，再去塑造下一轮：

1. **对话** —— 用目标语言说或写，自然的回复即时返回。是真实对话，不是测验。
2. **纠错** —— 修正就落在你写的那句上：错误片段、正解、更地道的改写，以及随手可点的语法讲解。
3. **记住** —— 每个错误、每次说对、每个表达缺口，都成为本地学习记忆里的一条信号。
4. **复习** —— 到期的条目会悄悄回来，编进你的下一段对话和训练练习。

## 当前状态

v1 核心链路已完成并可日常使用。当前重点是桌面端、本地数据、BYOK 模型接入和可定制的语言学习工作流。

## 已实现功能

### 对话与批改

- 目标语言流式对话回复,批改 agent 并行运行,不阻塞首 token。
- Coach Panel 展示本轮反馈、系统记下的学习信号、到期复习项和自定义观察结果。
- 结构化批改:完整改正版、更地道说法、错误 span、母语解释、严重程度和可追踪 mastery key。
- 表达缺口:母语 / 混说输入会进入“这句话怎么说”的教学面板,而不是普通红绿 diff。
- 多会话侧边栏、置顶、日期分组、会话标题自动生成。
- 长对话滚动摘要、上下文用量提示、`/btw` 离档问答。
- 会话动作:从此处分支、重新开始、升降难度、调换角色、第二天继续、变换场景。

### 学习记忆与复习

- 本地 SQLite 记录掌握项和证据时间线,error / correct / introduced / gap 都可追溯。
- Markdown 学习者档案记录个人事实、兴趣、正在练什么、已掌握什么和用户手写 notes。
- AI preferences 可按对话、批改、课程、阅读帮助等场景影响不同 agent。
- 代码根据薄弱程度和遗忘曲线选出 due review,再自然编进对话和训练。
- 已掌握项会作为解释和迁移的脚手架,避免系统只盯着错误。
- 学习数据页支持查看证据、手动编辑、自然语言修改预览和确认写入。
- 课程回顾和训练回写会先预览证据,再由用户确认进入长期记忆。

### 训练中心与专项课

- 内置训练:情景演练、听写、弱项闪练。
- 听写会把听错词记录到独立听力维度,后续句子可自适应复现这些词。
- 弱项闪练会把到期复习项变成必须主动产出的短任务。
- 自定义训练使用 `converloop/drill@1` Markdown 文档:frontmatter 定义机制,正文定义 prompt。
- 训练可带主题推荐、训练观察者、节末训练报告和导入 / 导出。
- 专项课会新开老师型会话,可围绕语法、表达缺口、今日复盘或用户目标集中练习。
- Task Agent 可把“我要准备面试 / 商务邮件 / 某类表达”生成学习项目和最多 3 个专项课草案。
- 练习统计卡展示概览、趋势、知识点和易错点。

### 能力库与自定义 Agent

- 能力库按入口展示内置能力:对话、批改、课程、训练观察者、回复讲解、双语对照、划词解析、会话动作等。
- 内置能力可启停、隐藏、追加补充指令,运行记录写入 agent job 日志。
- 可创建自定义 observer、action 和 reply transformer。
- observer 可在每轮后写 Coach 注释,需要写入学习记忆时只能提出待确认提案。
- action 可从当前对话推导新会话或把对话转成专项课。
- reply transformer 可作为回复 / 用户消息按钮,输出到面板、替换文本、Coach 或记忆提案。
- 支持 `converloop.package` 导入 / 导出专项课和技能包,兼容旧版 package。

### 语音、阅读与模型

- LLM provider:OpenAI 兼容端点、Anthropic、Gemini,以及 Claude / ChatGPT 订阅 OAuth 登录路径。
- STT:Soniox 实时流式、OpenAI 兼容批量转写、本地 Parakeet、本地 Qwen3-ASR。
- TTS:免费 Edge Read Aloud 和 MiMo TTS,支持自动朗读、手动朗读、语速 / 音高 / voice 配置和缓存。
- 双语阅读、按需讲解、划词翻译 / 解析都作为可审计能力接入。
- “磨耳朵”听力页可把过往对话句子变成可播放听力材料。

### 本地数据与桌面体验

- 首启引导配置界面语言、母语、目标语、水平和 provider。
- API key、OAuth token、STT/TTS key 都走本地加密存储,备份不包含密钥。
- 一键导出 / 导入可读 JSON 备份:会话、学习数据、档案和非密设置。
- 设置镜像可在 WebView 数据丢失后恢复 provider、语音、主题、快捷键等关键配置。
- 支持中英文界面、命令面板、快捷键编辑、主题 / accent 配置。
- macOS 和 Windows 都在 CI 中编译验证。

## 技术栈

- Tauri v2, Rust, React 19, TypeScript, Vite
- SQLite:`tauri-plugin-sql` + Drizzle sqlite-proxy
- Zod + `zod-to-json-schema` 生成结构化输出 schema
- 设备绑定加密密钥存储:`src-tauri/src/secrets.rs`
- pnpm, Biome, Vitest, GitHub Actions

## 快速开始

前置依赖:

- Node.js 22
- pnpm 11(via Corepack)
- Rust stable
- 当前系统所需的 Tauri v2 依赖

安装依赖并启动桌面端:

```bash
corepack enable
pnpm install
pnpm tauri dev
```

应用启动后,进入设置页配置 provider 和 API key。密钥走本地加密存储,不会进入备份文件。

## 常用命令

| 命令 | 用途 |
|---|---|
| `pnpm tauri dev` | 启动 Tauri 桌面端 + Vite HMR |
| `pnpm build` | TypeScript 检查并构建前端 |
| `pnpm test` | 运行 Vitest |
| `pnpm check` | 运行 Biome + TypeScript 检查 |
| `pnpm format` | 应用 Biome 格式化修复 |
| `pnpm tauri build` | 构建桌面安装包 |

不要随手运行 `cargo update`:`Cargo.lock` 刻意把 `bitflags` 钉在 `2.9.1`,新版目前会在这个栈里触发 `dispatch2` 宏递归编译失败。

## 架构

核心铁律:conversation agent 读 Markdown,tutor agent 读 SQLite;代码写 SQLite,profile maintainer 写 Markdown。LLM 只观察并提出离散信号,计数、状态迁移、持久化和写入安全都归代码。

当前产品形态、核心设计原则和后续开发指导见 [docs/design.md](docs/design.md)。实现细节以代码、类型和测试为准。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/design.md](docs/design.md) | 当前产品形态、核心设计原则和后续开发指导 |
| [AGENTS.md](AGENTS.md) | 本仓库 AI coding agent 工作规则 |

## 隐私与安全

- 学习数据、设置镜像和档案文档都存本地。
- API key 与 OAuth token 不进备份,并用设备绑定 key 加密。
- 当前密钥存储没有主密码,安全上限是防误传 / 随手翻,不是抵御可读磁盘的攻击者。
- 备份导出的是应用数据和非密设置的可读 JSON。

## 开发与贡献

改动保持小步、聚焦当前学习链路。prompt、schema、migration、provider 等实现细节以代码和测试为准;只有设计原则或边界变化时才更新 [docs/design.md](docs/design.md)。开 PR 前运行:

```bash
pnpm check
pnpm test
```

## 许可证

Converloop 采用**双重许可**：

- **开源 —— [GNU AGPL-3.0-or-later](LICENSE)。** 你可以自由使用、修改和自托管。注意 AGPL 的网络条款：如果你把修改版作为网络服务运行，必须以 AGPL 公开你的修改源码。
- **商业许可。** 对于无法或不愿遵守 AGPL 的情况（例如发布闭源构建，或运行托管服务但不公开改动），另提供单独的专有商业许可，见 [COMMERCIAL.md](COMMERCIAL.md)。

外部贡献依据[贡献者许可协议（CLA）](CLA.md)接受，正是它让双重许可模式得以成立。
