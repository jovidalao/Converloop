# Profile Maintainer Agent

维护学习者的 **MD 叙述档案**(`learner-profile.md`)。它是三个 agent 里唯一**写 MD** 的;对话 / 导师 agent 只读不写。

## 它在系统里的位置

```
每轮(热路径,便宜、确定性,不涉及本 agent):
  输入 → 对话Agent(读 MD) ∥ 导师Agent(读 SQLite)
       → 代码把 issues 派生成 SQLite 信号(error)
       → mastery_updates 写入 SQLite 信号(correct / introduced)
       → 秒回 + 批改面板

偶尔(本 agent,后台,用 LLM):
  Maintainer 读【现有 MD】+【SQLite 聚合】+【近期对话】
            → 产出更新后的 MD
```

**分工铁律:** SQLite 是计数/状态的地面真相(代码维护);MD 是定性人设(本 agent 维护)。本 agent **不负责计数**——计数已经在 SQLite 里,它只负责把数据 + 对话**翻译成人能读、对话 agent 能用的叙述**。

## 触发条件

不要每轮跑(每轮重写 = 越用越贵 + 高频漂移)。用下面任一条触发,并做去抖:

| 触发 | 说明 |
|---|---|
| 每 N 轮 | 默认 `N = 10`。计数器到了就排一次后台任务。 |
| 会话结束 | 关闭 app / 切走 / 空闲超过 ~10 分钟。 |
| 显著变化 | SQLite 出现"新 struggling 项"或"某项升到 known"时,标记 dirty,下次触发时一并刷新。 |
| 手动 | 用户在档案页点"刷新档案"。 |

实现要点:
- **去抖 + 单飞**:同一时间只允许一个维护任务在跑,新触发合并进去。
- **后台执行**:绝不阻塞热路径。失败就保留旧 MD,下次再试(MD 永远有一个可用版本)。

## 输入

```
1. 现有 learner-profile.md 全文          // 要更新,不是从零重写
2. SQLite 聚合(代码查好再喂,别让它自己算):
   - 薄弱 top 15:label / mastery_key / type / error_count / seen_count / status / last_seen
   - 最近升到 known 的项(可移入"已掌握")
   - 最近 introduced 的项(放"最近学到")
3. 近期对话片段:上次维护之后的 transcript(截断到约 1500 token)
4. config:native / target / level
```

## System Prompt

```text
You maintain a learner's profile document for a {native_language} speaker
learning {target_language}. The profile is read by a conversation agent to
personalize replies, and by the user, who may edit it by hand.

You are given: the CURRENT profile, structured mastery data (with real counts),
and a recent conversation transcript. Produce an UPDATED profile.

HARD RULES
- Update, do not rewrite from scratch. Preserve the structure and wording of
  sections you have no new evidence to change.
- Ground every statement in the provided data or transcript. Never invent
  weaknesses, interests, or progress that the inputs do not support.
- The structured mastery data is the source of truth for what the user struggles
  with or has mastered. The transcript is the source of truth for interests,
  tone, and conversational tendencies. Do not contradict the counts.
- "## About me" holds DURABLE personal facts the user has shared about their life
  (job, studies and what stage, location, family, ongoing situations) so the
  conversation agent remembers who they are across sessions. Add or update a fact
  only when the transcript clearly states it; carry existing facts forward; drop
  ones the user has contradicted. Never guess or infer beyond what was said. Skip
  one-off small talk that is not a lasting fact about the person.
- NEVER touch the "## My notes" section — copy it through verbatim. It belongs to
  the user.
- Keep it concise: at most 6 bullets per section. Prune items that are stale
  (not seen recently) or resolved (now "known"). Quality over completeness — this
  goes into a prompt every turn.
- Only change the level (e.g. B1 → B2) when the data clearly justifies it, and
  keep the same level otherwise.
- Update the "updated" date in the header to {today}.

OUTPUT
- Return ONLY the full updated profile in Markdown, using exactly these section
  headers, in this order:
    # Learner Profile  ·  {native} → {target} · {level} · updated {today}
    ## About me
    ## Working on
    ## Comfortable with
    ## Avoids / rarely attempts
    ## Interests
    ## Recently introduced
    ## My notes
- No commentary, no explanation, no code fences. Just the document.
```

User message 模板:

```text
=== CURRENT PROFILE ===
{current_md}

=== MASTERY DATA (source of truth for strengths/weaknesses) ===
Struggling / learning (top 15):
{rows: "- [grammar] article usage (grammar:article_usage) — 6/9 errors, status=struggling, last seen 2d ago"}
Recently reached "known":
{rows}
Recently introduced:
{rows}

=== RECENT TRANSCRIPT (source of truth for interests/tone) ===
{transcript}

Produce the updated profile now.
```

## 输出处理(代码侧)

MD 是 prose,没法 schema 校验,但要做轻量 sanity check,**任何一项不过就丢弃本次结果、保留旧 MD**:

- 含全部 7 个必需的 `##` 段标题(含 `## About me`);
- `## My notes` 的内容和输入**逐字一致**(防 agent 改用户笔记);
- 长度没有异常坍缩(比如不到旧版的 30%,疑似把内容吃掉了);
- 通过后**原子写入**(写临时文件再 rename),避免对话 agent 读到半截文件。

## learner-profile.md 模板

```md
# Learner Profile  ·  Chinese → English · B1 · updated 2026-05-29

## About me
- 前端工程师,最近换了新工作;在职读研

## Working on
- 冠词 a/an/the —— 仍不稳,抽象名词前尤其

## Comfortable with
- 一般过去时、基本疑问句

## Avoids / rarely attempts
- 条件句、现在完成时

## Interests
- 做饭、徒步、前端开发

## Recently introduced
- "look forward to", "pay attention to"

## My notes
<!-- 用户手写区,agent 永不改动 -->
```

## 设计取舍记录

- **为什么不每轮跑:** 每轮重写整份 MD = 每轮多一次随档案变大而变贵的 LLM 调用,且高频重写会让档案缓慢漂移/失真。批量跑同时压住成本和漂移。
- **为什么 SQLite 和 MD 并存:** 只用 MD 会丢掉可信计数、可排序查询、进度可视化(见 [architecture] 决策)。只用 SQLite 则对话 agent 拿不到"这个人是谁"的定性人设。两层各管一摊。
- **为什么保留 `## My notes`:** 让用户能纠正 agent 的误判,建立信任;本地优先的学习数据,可读可编是卖点。
