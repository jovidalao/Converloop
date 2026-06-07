# lang-agent

AI 语言学习 agent 的**开源桌面端**(v1)。

## 如果你是新会话,先读这里

**当前状态:v1 核心链路已完成并可用。** scaffold、SQLite、三个 provider、导师 + 对话 + 编排、MD 档案 + 维护 agent(含会话结束/空闲触发)、多会话、按需讲解、朗读(TTS)、母语/混说表达缺口、专项课/学习项目、能力库/自定义 Agent、分享包都已落地。完整状态见 [architecture.md#状态--路线图](docs/architecture.md#状态--路线图);界面持续打磨见 [ui-guide.md](docs/ui-guide.md)。

**动手前必读(15 分钟):**
1. [docs/README.md](docs/README.md) — 设计总览与索引
2. [docs/architecture.md](docs/architecture.md) — 范围、数据流、存储/schema、provider、密钥、状态/路线图、踩坑记录
3. 三个 agent 契约:[conversation](docs/conversation-agent.md) / [tutor](docs/tutor-agent.md) / [profile-maintainer](docs/profile-maintainer-agent.md);母语/混说链路 [expression-gap](docs/expression-gap.md)

> prompt 在 docs(契约)与 `src/agents/*.ts`(实现)各一份,改一处记得同步另一处。

## 它是什么

桌面端:用户用目标语言输入 → 得到①自然对话回复(秒回流式)②精准批改 → 系统精准记录掌握情况并定向影响后续回复。复习靠对话被动复用薄弱项,不做抽认卡。

## v1 范围(刻意收窄,别越界)

- ✅ Tauri 桌面端 · BYOK · 多 agent 流水线 · 本地 SQLite · LLM 维护的 MD 档案
- ❌ 没有云/同步/计费/Web/手机/托管模型/抽认卡 SRS
- 不假设本地 LLM:默认 BYOK 托管模型(OpenAI 兼容 / Anthropic / Gemini)

## 技术栈(已定,别再选型)

- Tauri v2 + React + TypeScript + Vite
- SQLite:`tauri-plugin-sql`(Rust 侧)+ Drizzle 的 **sqlite-proxy** driver 桥接
- Zod(schema)+ `zod-to-json-schema`(给 LLM 结构化输出)
- 密钥:应用自管的设备绑定加密文件(`src-tauri/src/secrets.rs`,XChaCha20-Poly1305,无主密码 → 混淆级),**绝不明文**。要真加密再上 `tauri-plugin-stronghold`(主密码)
- 包管理:pnpm

## 架构铁律(改之前先理解为什么)

- **对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。**
- **LLM 只观察(给离散信号),代码负责记账(计数/置信度/状态)。** LLM 永不碰计数。
- `mastery_key` 跨句必须稳定(同一类错永远同一个 key)——这是掌握系统的地基。
- 热路径只有 2 个 agent(对话 ∥ 导师),并行;维护 agent 在后台批量跑。

## 工作方式

- 小步增量:一次一个改动,自己定可验证的验收标准,达到了再继续。
- 改动只服务当前任务,别顺手"改进"无关代码。
- 不确定就先问,别替我假设产品决策。
