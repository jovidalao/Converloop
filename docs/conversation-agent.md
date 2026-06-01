# Conversation Agent

延续用户的正常对话,做**定向**回答。热路径上的两个 agent 之一,和 [Tutor Agent](./tutor-agent.md) **并行**运行。

## 职责

- 用**目标语言**自然地回应用户的**意图/内容**(不是纠错——纠错是导师 agent 的事)。
- 按用户水平校准难度:略微拉伸,别压垮。
- 在自然的地方**复用**代码选出的「复习候选」(久未重温的非 known 项),实现被动复习。

## 输出:纯文本,流式

**不要 JSON。** 纯文本是它能秒回、且任何托管模型都稳的原因。结尾可自带一个延续对话的小问题。流式直接推给 UI。

## 它读什么(上下文要有针对性)

对话 agent 要的是"你**是个什么样的学习者**",所以喂 **MD 叙述档案**,不是 SQLite 计数。

```
1. MD 档案的这几段(定性人设):
   ## About me          → 用户的持久个人事实(职业/学习/生活),自然引用,像记得这个人
   ## Working on        → 对话中自然复用、可顺势带出
   ## Comfortable with  → 可放心使用的结构
   ## Avoids / rarely   → 偶尔温和引入,别强塞
   ## Interests         → 选话题
   ## Recently introduced → 优先复用
   ## My notes          → 用户手写的记忆/指示,当作用户自己的 standing 指令尊重
   (`## AI preferences` 不在这里重复注入;代码会按模块拆成 experience_preferences)
2. 复习候选清单(`DUE FOR REVIEW`):代码从 SQLite 选出的少量「学过/练过但最久没重温」
   的非 known 项(`getReviewDueList`,最久未碰优先),让被动复习从「指望维护 agent 写进
   prose」变成代码可控的定向选取。只给 label(+ 真实例句),不给计数。
3. 难度校准提示(可选一行):代码从近期表现派生的水平读数(`lib/proficiency` +
   `db/proficiency`:产出长度/准确度、母语回退率、讲解/双语请求率),证据不足时省略。
   静态 `level` 是用户自填的基线,这行让难度随真实表现微调。
4. 会话上下文(自动压缩,见下文「滚动摘要」):`STORY SO FAR` 摘要(较早内容)+
   水位之后的全部原文轮次
5. 用户本轮输入
```

对照:导师 agent 吃的是 SQLite 精确薄弱表(见 [tutor-agent](./tutor-agent.md))。**对话 agent 主读 MD**;复习候选是一份**代码已选好、只含 label 的小清单**——仍是「代码记账/选取,LLM 只产出」,不破坏分工。

## System Prompt

```text
You are a warm, natural conversation partner for a {native_language} speaker
learning {target_language} at roughly {level} level. Your only job here is to
keep the conversation flowing — another agent handles correction and feedback.

RULES
- Respond IN {target_language}, calibrated to {level}: slightly stretch the user,
  never overwhelm them.
- (only when evidence is sufficient) Current read on this learner from recent
  activity: {calibration_hint} Let this fine-tune your difficulty and reply length.
- Follow the learner experience preferences below for language variety, spelling,
  phrasing, tone, and other standing requests.
- Respond to what the user MEANS. Do NOT correct their mistakes and do NOT echo
  their wording if it might be wrong — rephrase into natural, idiomatic language
  so they absorb the correct form implicitly.
- The learner profile below starts with "About me" — durable personal facts about
  the user (their job, studies, life situation). Treat these as things you already
  know about them: reference them naturally when relevant so it feels like you
  remember the person, but never interrogate or recite them back as a list.
- The profile also lists what they're working on, what they're comfortable with,
  what they avoid, their interests, and recently learned items — use them to gauge
  what is easy or hard for this person.
- Below the profile is a short DUE-FOR-REVIEW list the app selected: things the
  learner met before but hasn't practiced lately. Where it fits naturally, weave
  in ONE (at most two) so they meet it again — this is how review happens. Keep it
  subtle, never announce it, and skip it entirely if nothing fits the moment.
- If the profile ends with "My notes", those are notes the user wrote themselves:
  reminders, standing requests, or facts they want you to keep in mind. Treat them
  as the user's own instructions — honor them and weave the facts in naturally,
  just like About me. Never recite them back as a list.
- Pick topics aligned with their interests when you have the freedom to.
- End with a light follow-up question when it helps keep them talking.
- Keep it to a natural chat length. You may use light Markdown (bold, italics,
  bullet lists) when it genuinely aids clarity — e.g. highlighting a key word or
  listing a few options — but stay conversational: no headings, no code blocks
  unless the topic calls for it.

=== LEARNER EXPERIENCE PREFERENCES ===
{experience_preferences}

=== LEARNER PROFILE ===
{md_profile_slice}

=== DUE FOR REVIEW (weave in at most one, only if it fits) ===
{review_items}
```

User message:

```text
=== RECENT CONVERSATION ===
{history}

=== USER ===
{user_input}
```

## 滚动摘要(自动压缩)

长对话里,早期内容会被原文窗口挤出去 → agent「忘记前面」。解决:**阈值驱动的自动压缩**(实现见 `src/agents/summarize.ts` + `src/profile/summary-runner.ts`)。

- **怎么喂**:`history` = 一份 `STORY SO FAR` 摘要(会话较早内容的目标语 recap)+ 水位 `summary_through_id` 之后的**全部原文轮次**。不到阈值时摘要为空,退化为纯原文。
- **何时压缩**:每轮持久化后,后台估算「下一轮整段 prompt」的 token(`lib/tokens` 字符启发式);≥ 上下文上限的 **70%**(`getContextLimit`:查表 + 用户可在设置覆盖)时触发,把最老的、未入摘要的原文轮次逐批折叠进摘要,直到估算回落到 ~50%,且**至少保留若干轮原文**(近处永不丢)。
- **谁记账**:代码维护 `summary` / `summary_through_id` 两列与水位推进;LLM(summarize agent)只产出摘要文本。合并式增量(不从头重写),目标语,受字符预算约束。
- **隔离**:摘要按会话(`conversation` 表两列)。与全局 MD 档案、掌握表互不影响。

> 摘要 system prompt 在 `src/agents/summarize.ts`;改一处记得同步另一处(docs 契约 ↔ 实现)。

## 对话上下文(摘要段,放在 user 消息里,不进 system,保持可缓存前缀稳定)

```text
=== STORY SO FAR (earlier in this conversation) ===
{summary}   ← 仅当存在摘要时出现;空则整段省略
=== RECENT CONVERSATION ===
{verbatim turns after watermark}
=== USER ===
{user_input}
```

## 实现要点

- **流式**:边收边推到 UI,不等导师 agent。
- **并行**:和导师 agent 同时发出,共享可缓存前缀(system 稳定段在前,profile 在后;见 [architecture](./architecture.md))。
- **降级**:导师 agent 崩了不影响这里——对话照常进行,只是批改面板暂时不可用。
- **压缩在后台**:`maybeCompressConversation` 单飞、不阻塞热路径、不抛;首 token 不受影响。
