# Converloop

AI 语言学习 agent 的本地优先桌面端。

## 如果你是新会话,先读这里

先读:
1. [README.md](README.md) — 项目入口与运行方式
2. [docs/design.md](docs/design.md) — 唯一长期设计文档

> prompt、schema、migration、provider 细节以代码和测试为准;文档只写长期设计原则。

## 不要破坏的铁律

- **对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。**
- **LLM 只观察,代码负责记账。** LLM 永不直接改计数、密钥、provider 或隐藏设置。
- `mastery_key` 跨句必须稳定。
- v1 不做云/同步/计费/Web/手机/托管模型/抽认卡 SRS。

## 工作方式

- 小步增量:一次一个改动,自己定可验证的验收标准,达到了再继续。
- 改动只服务当前任务,别顺手"改进"无关代码。
- 不确定就先问,别替我假设产品决策。
