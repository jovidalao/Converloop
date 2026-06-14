# lang-agent —— 设计总览与文档索引

AI 语言学习 agent 的开源桌面端(v1)。本文件是 `docs/` 的入口:产品愿景 + 设计目标 + 文档地图。**范围、架构铁律、数据流、存储/schema 的权威定义都在 [architecture.md](./architecture.md)**,本文不重复。

## 长期愿景

开源的是**学习系统本身**,收费的是把它变成省心、跨端的**云服务**。

- 开源:本地 agent、学习/记忆/复习算法、prompt、本地数据库结构、provider adapter、桌面端。
- 收费:托管模型、云同步、备份、Web 端、手机端、高质量语音、免配置体验。
- 关键解耦:**模型来源**和**数据同步**是两个独立开关。

> 愿景仅作背景。**v1 只做桌面端 + BYOK + 多 agent + 本地 SQLite + LLM 维护的 MD 档案**,云/同步/计费/Web/手机全部往后放。护城河是**学习质量**,不是基础设施。

## 设计目标(v1 要做到的事)

1. 用户用目标语言输入一句话,得到**自然对话回复**(秒回、流式)+ **精准批改**(纠错 / 更地道说法 / 母语讲解)。
2. 系统**精准记录用户对目标语言的掌握情况**,并让它**定向影响后续每一次回复**。
3. 复习靠对话里**被动复用**薄弱项实现(interleaving),不做抽认卡。
4. 学习数据**本地优先、可读、可编辑**(信任 + 隐私是卖点)。

## 核心设计(权威定义见 architecture.md)

- **两层存储**:SQLite = 计数/状态的地面真相(代码维护);MD 档案 = 定性人设(维护 agent 维护)。各管一摊。
- **架构铁律**:对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。LLM 只观察(给离散信号),代码负责记账。`mastery_key` 跨句必须稳定。
- **热路径**只有对话 ∥ 导师两个 agent;维护、任务规划、讲解都在后台 / 按需。

## 文档地图

**先读 [architecture.md](./architecture.md)** —— 范围、数据流、存储/schema、provider、密钥、缓存、**状态/路线图**、踩坑记录。然后按需读:

热路径 agent 契约:

- [conversation-agent.md](./conversation-agent.md) — 对话 agent(读 MD,流式回复)
- [tutor-agent.md](./tutor-agent.md) — 导师 agent(读 SQLite,结构化批改 + 掌握信号)
- [expression-gap.md](./expression-gap.md) — tutor 的扩展:母语/混说 → 表达缺口
- [profile-maintainer-agent.md](./profile-maintainer-agent.md) — 维护 agent(后台重写 MD 档案)

辅助 agent 与子系统:

- [lessons.md](./lessons.md) — 学习项目(Task Agent 规划)+ 专项课(Learning Agent)
- [drills.md](./drills.md) — 训练模式:drill@1 Markdown 文档格式、能力注册表、兼容规则、AI 创建闭环

界面与平台:

- [ui-guide.md](./ui-guide.md) — Craft 风格设计纪律 + 字号/颜色规范 + 验收
- [cross-platform.md](./cross-platform.md) — 跨平台(macOS + Windows)开发约定、Windows 适配现状、CI 矩阵
