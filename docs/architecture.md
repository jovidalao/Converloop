# Architecture (v1)

AI 语言学习 agent —— 第一版范围与数据流。

## v1 范围(刻意收窄)

> **Tauri 桌面端 + BYOK + 多 agent 流水线 + 本地 SQLite + LLM 维护的 MD 档案。**
> 没有云、没有同步、没有计费、没有 Web/手机、没有托管模型、没有语音、没有抽认卡 SRS。

护城河是**学习质量**(纠错准不准、人设跟不跟得上),不是基础设施。先把桌面端打磨到自己每天愿意用,再谈规模化。

**不假设本地 LLM。** 绝大多数用户跑不动像样的本地模型,现实默认是 **BYOK 托管模型**(OpenAI / Claude / OpenRouter);本地模型(Ollama 等)是可选高级功能,不是设计约束。

## 三个 Agent

| Agent | 何时跑 | 读什么 | 输出 | 文档 |
|---|---|---|---|---|
| Conversation | 每轮(热) | MD 叙述档案 + 对话 | 纯文本,流式 | [conversation-agent](./conversation-agent.md) |
| Tutor | 每轮(热,与上者并行) | SQLite 薄弱表 + 输入 | 结构化 `TutorAnalysis` | [tutor-agent](./tutor-agent.md) |
| Profile Maintainer | 偶尔(后台) | 现有 MD + SQLite 聚合 + 近期对话 | 更新后的 MD | [profile-maintainer-agent](./profile-maintainer-agent.md) |

热路径只有 2 个 agent,并行;维护 agent 在后台批量跑,不拖慢用户。

## 两层存储:各管一摊(核心决策)

| 层 | 存什么 | 谁维护 | 为什么 |
|---|---|---|---|
| **SQLite**(地面真相) | 每个掌握项的 error_count / seen_count / last_seen / status | **代码**(每轮从信号派生) | 确定性、可排序查询、可画进度。LLM 不碰计数。 |
| **MD 档案**(叙述层) | 定性人设:在练什么、已掌握、回避、兴趣、最近学到 | **维护 agent**(偶尔) | 人类可读可编、直接喂对话 agent。捕捉列存表达不了的定性状态。 |

**为什么不二选一:** 只用 MD → 丢掉可信计数、可排序、进度可视化(prose 是氛围不是数据,LLM 重写还会漂移)。只用 SQLite → 对话 agent 拿不到"这个人是谁"的定性人设。所以:**对话 agent 读 MD,导师 agent 读 SQLite,代码写 SQLite,维护 agent 写 MD。**

## 数据流

```
每轮(热路径,便宜、确定性):
  用户输入
    → 共享上下文(system 稳定段[缓存断点] + profile + history + input)
    → Conversation Agent(读 MD 切片) ∥ Tutor Agent(读 SQLite 薄弱表)
    → 对话流式秒回给用户;批改稍后补到批改面板
    → 代码记账:
        issues[]          → 派生 "error" 信号 → 写 SQLite
        mastery_updates[] → "correct" / "introduced" 信号 → 写 SQLite
    → 持久化本轮(input / reply / analysis)

偶尔(每 N 轮 / 会话结束 / 显著变化 / 手动):
  Profile Maintainer 读 现有 MD + SQLite 聚合 + 近期对话
    → 产出更新后的 learner-profile.md(原子写入)
```

## SQLite:mastery_item(起点,别一上来搞知识追踪)

```ts
// mastery_item
{
  id: string
  type: 'vocab' | 'grammar' | 'collocation' | 'error_pattern'
  key: string              // 稳定 upsert 键,= Issue.mastery_key,如 "grammar:article_usage"
  label: string            // "冠词 a/an/the 的用法"
  status: 'struggling' | 'learning' | 'known'
  seen_count: number
  error_count: number
  last_seen_at: number
  example?: string         // 用户真实出错句,最有价值
  notes?: string           // 用户可编辑
}
```

记账公式见 [tutor-agent](./tutor-agent.md#代码侧记账分数归代码管)。

## 选 top-N 喂回 prompt

不能把整表塞进 prompt。每轮按**薄弱 + 近期**选少量:

```sql
-- 导师 agent 的薄弱表:优先 struggling、错得多、最近见过
SELECT key, label, type, status
FROM mastery_item
WHERE status != 'known'
ORDER BY (error_count * 1.0 / MAX(seen_count, 1)) DESC, last_seen_at DESC
LIMIT 15;
```

规则不够用时再考虑用向量做"相关性检索"——那才是向量库该出场的地方,**不是 v1**。

## 缓存与延迟

- 把稳定的 system 段放最前,打缓存断点(Anthropic `cache_control` / OpenAI 自动前缀缓存);profile 每轮变,放断点之后。两个热 agent 共享前缀 → 命中。
- ⚠️ 缓存只省**输入** token,且有最小长度门槛。多 agent **不比单调用便宜**(略贵 10–15%)。真正收益是**延迟**(并行 + 对话流式秒回)和**关注点分离**,不是省钱。
- orchestrator 留成可在"单调用 / 多 agent"间切换:agent-core 本就 provider 无关,这层抽象几乎免费。

## 开工前(顺序别反)

1. **半天,不写代码:** 真实句子手动验证三个 prompt,重点盯 Tutor 的 `mastery_key` 跨句**稳定性**。
2. **第一周第一个编码任务 = 技术探针:** 验证 Tauri webview 里 **Drizzle + SQLite** 能读写 + 跑 migration(webview 不是 Node,不开箱即用,用 Drizzle sqlite-proxy 或 wa-sqlite)。
3. **密钥存设备绑定加密文件**(应用自管,无主密码 → 混淆级;`src-tauri/src/secrets.rs`:XChaCha20-Poly1305,密钥 = 本地随机 keyfile + 机器标识派生),绝不明文。要真加密需主密码,届时换 `tauri-plugin-stronghold`。
4. 然后正式开发。

## 复习去哪了

砍掉抽认卡 SRS 功能。复习靠对话 agent 在聊天里**被动复用**薄弱项/最近学到项实现(interleaving),比抽认卡更自然,且不需要排程 UI。需要的话以后再用 FSRS 加回显式复习。
