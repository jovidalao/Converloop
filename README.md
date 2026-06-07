# lang-agent

AI 语言学习 agent 的**开源桌面端**(v1)。

用目标语言输入一句话 → 立刻得到①自然对话回复(流式秒回)②精准批改(纠错 / 更地道说法 / 母语讲解)。系统在本地精准记录你的掌握情况,并让它定向影响后续每一次回复。复习靠对话被动复用薄弱项(interleaving),不做抽认卡。

> 状态:v1 核心链路已完成并可用(对话 + 批改 + 掌握记账 + MD 档案 + 多会话 + 朗读 + 按需讲解)。详见 [docs/architecture.md](docs/architecture.md#状态--路线图)。

## 它是什么

- **桌面端 · BYOK**:自带 API key(OpenAI 兼容 / Anthropic / Gemini),数据全本地。
- **多 agent 流水线**:每轮并行跑「对话 agent」(流式回复)和「导师 agent」(结构化批改)。
- **两层存储**:SQLite 记掌握计数(代码维护),Markdown 档案记定性人设(LLM 维护)。

## 技术栈

Tauri v2 + React 19 + TypeScript + Vite · SQLite(`tauri-plugin-sql` + Drizzle sqlite-proxy)· Zod + `zod-to-json-schema` · 设备绑定加密的密钥存储(`src-tauri/src/secrets.rs`)· pnpm。

## 快速开始

```bash
pnpm install
pnpm tauri dev      # 开发(开桌面窗口 + HMR)
pnpm test           # vitest
pnpm tauri build    # 打包
```

启动后进**设置页**填 provider + API key(BYOK,加密存本地),即可在聊天页使用。

> ⚠️ 别随手 `cargo update`:`Cargo.lock` 把 `bitflags` 钉在 `2.9.1`,升级会触发 `dispatch2` 宏递归编译失败。其他踩坑见 [docs/architecture.md#踩坑记录](docs/architecture.md#踩坑记录).

## 文档

设计与契约都在 [docs/](docs/):

- [docs/README.md](docs/README.md) — 设计总览与索引(先读这个)
- [docs/architecture.md](docs/architecture.md) — 范围、数据流、存储、schema、状态/路线图
- 三个核心 agent 契约:[conversation](docs/conversation-agent.md) · [tutor](docs/tutor-agent.md) · [profile-maintainer](docs/profile-maintainer-agent.md)
- [docs/expression-gap.md](docs/expression-gap.md) — 母语/混说 → 表达缺口

## v1 范围(刻意收窄)

✅ Tauri 桌面端 · BYOK · 多 agent · 本地 SQLite · LLM 维护的 MD 档案 · 朗读(TTS)· 按需讲解
❌ 云 / 同步 / 计费 / Web / 手机 / 托管模型 / 抽认卡 SRS
