# lang-agent —— 设计总览

AI 语言学习 agent 的开源桌面端(v1)。本文件是入口,详细设计见同目录其他文档。

## 长期愿景

开源的是**学习系统本身**,收费的是把它变成省心、跨端的**云服务**。
- 开源:本地 agent、学习/记忆/复习算法、prompt、本地数据库结构、provider adapter、桌面端。
- 收费:托管模型、云同步、备份、Web 端、手机端、高质量语音、免配置体验。
- 关键解耦:**模型来源**和**数据同步**是两个独立开关。

> 愿景仅作背景。**v1 只做下面这一小块,云/同步/计费/Web/手机全部往后放。**

## v1 范围(刻意收窄)

**Tauri 桌面端 + BYOK + 多 agent 流水线 + 本地 SQLite + LLM 维护的 MD 档案。**
没有云、没有同步、没有计费、没有 Web/手机、没有托管模型、没有抽认卡 SRS。

- 护城河是**学习质量**,不是基础设施。先打磨到自己每天愿意用。
- **不假设本地 LLM**:现实默认是 BYOK 托管模型(OpenAI 兼容 / Anthropic / Gemini);本地模型是可选高级功能。

## 设计目标(v1 要做到的事)

1. 用户用目标语言输入一句话,得到**自然对话回复**(秒回、流式)+ **精准批改**(纠错 / 更地道说法 / 母语讲解)。
2. 系统**精准记录用户对目标语言的掌握情况**,并让它**定向影响后续每一次回复**。
3. 复习靠对话里**被动复用**薄弱项实现(interleaving),不做抽认卡。
4. 学习数据**本地优先、可读、可编辑**(信任 + 隐私是卖点)。

## 三个核心 Agent(+ 四个辅助)

- **Conversation Agent**(每轮,热,纯文本流式)— 读 MD 档案 + 对话,定向延续对话,不纠错。
- **Tutor Agent**(每轮,热,与上者并行)— 读 SQLite 薄弱表 + 输入,输出结构化 `TutorAnalysis`(纠错 + 掌握信号 + 表达缺口)。
- **Profile Maintainer Agent**(偶尔,后台)— 读现有 MD + SQLite 聚合 + 近期对话,重写 MD 档案。
- 辅助:**Task Agent / 学习项目**(把开放式学习需求变成项目 + 专项课草案)、**Learning Agent / 专项课**(定制化学习会话)、**Explain Agent**(按需,讲解对话回复)+ **TTS**(朗读),都不在热路径。见 [architecture](./architecture.md)。

## 两层存储(核心决策)

- **SQLite = 地面真相**:每个掌握项的计数/状态,**代码**每轮从信号派生维护。确定性、可排序、可画进度。LLM 不碰计数。
- **MD 档案 = 叙述层**:定性人设(在练什么/已掌握/回避/兴趣/最近学到/个人事实),**维护 agent** 偶尔重写。人类可读可编,直接喂对话 agent。

> 对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。

## 核心原则

- **LLM 观察,代码记账**:LLM 给离散信号(error / correct / introduced / gap),计数和置信度由代码算。
- **mastery_key 稳定**:同一类错误永远同一个 key,这是掌握系统的地基。
- **热路径便宜确定**,贵的 LLM 维护放后台批量跑。

## 文档

- [architecture.md](./architecture.md) — 范围、数据流、存储/schema、provider、密钥、缓存、**状态/路线图**、踩坑记录
- [agent-runtime-plan.md](./agent-runtime-plan.md) — **Agent-first 改进路线图**:把愿景落到代码的 6 阶段执行计划、差距对照、验收标准映射
- [task-agent.md](./task-agent.md) — 学习项目规划、agent_job 作业日志、课程包元数据与边界
- [learning-agent.md](./learning-agent.md) — 定制化学习 Agent / 专项课、内置复习、自然语言创建与数据修改
- 三个核心 agent 契约:[conversation-agent](./conversation-agent.md) · [tutor-agent](./tutor-agent.md) · [profile-maintainer-agent](./profile-maintainer-agent.md)
- [expression-gap.md](./expression-gap.md) — 母语/混说 → 表达缺口(已实现 + 复习页路线图)

> 当前状态与下一步见 [architecture.md#状态--路线图](./architecture.md#状态--路线图)。
