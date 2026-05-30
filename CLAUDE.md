# lang-agent

AI 语言学习 agent 的**开源桌面端**(v1)。

## 如果你是被叫来"开始开发"的新会话,先读这里

**当前状态:设计已完成,代码尚未开始。** 这个仓库目前只有 `docs/` 设计文档,没有任何应用代码、没有 scaffold、没有 package.json。

**你的第一步:** 打开 [docs/build-plan.md](docs/build-plan.md),从第一个未完成的任务开始(目前是 Task 0:scaffold Tauri 项目)。按顺序做,每个任务都有验收标准,做完一个再下一个。

**动手前必读(15 分钟):**
1. [docs/README.md](docs/README.md) — 设计总览
2. [docs/architecture.md](docs/architecture.md) — v1 范围、数据流、存储、schema
3. 三个 agent 契约:[conversation](docs/conversation-agent.md) / [tutor](docs/tutor-agent.md) / [profile-maintainer](docs/profile-maintainer-agent.md)

## 它是什么

桌面端:用户用目标语言输入 → 得到①自然对话回复(秒回流式)②精准批改 → 系统精准记录掌握情况并定向影响后续回复。复习靠对话被动复用薄弱项,不做抽认卡。

## v1 范围(刻意收窄,别越界)

- ✅ Tauri 桌面端 · BYOK · 多 agent 流水线 · 本地 SQLite · LLM 维护的 MD 档案
- ❌ 没有云/同步/计费/Web/手机/托管模型/语音/抽认卡 SRS
- 不假设本地 LLM:默认 BYOK 托管模型(OpenAI/Claude/OpenRouter)

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

- 小步增量:一次一个 build-plan 任务,达到验收标准再继续。
- 改动只服务当前任务,别顺手"改进"无关代码。
- 不确定就先问,别替我假设产品决策。
