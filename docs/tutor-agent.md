# Tutor Agent(语言导师)

分析用户本轮输入的正误,产出批改 + 掌握信号。热路径上的两个 agent 之一,和 [Conversation Agent](./conversation-agent.md) **并行**运行。

## 核心原则

> **LLM 只负责"观察"(报告这一轮发生了什么),代码负责"记账"(计数、置信度、状态)。**

不要让 LLM 输出 `confidence: 0.73` 这种数字——会是噪音。它给离散信号,分数你自己算,这样可调、可测、可信。

## 它读什么

导师 agent 要的是"你**具体在哪个点上错过几次**",所以喂 **SQLite 精确薄弱表**(不是 MD prose):

```
1. SQLite 薄弱表 top N:label / mastery_key / type / status
   (给精确的 mastery_key,是为了让它打标签时复用同一个 key、不重复造)
2. 最近几轮对话(理解语境)
3. 用户本轮输入
4. config:native / target / level
```

它**不看**对话 agent 的回复——只分析用户输入,所以可完全并行。

## 输出 schema(Zod)

```ts
import { z } from "zod";

const IssueCategory = z.enum([
  "grammar",
  "word_choice",
  "collocation",
  "spelling",
  "punctuation",
  "register",      // 正式/口语、语气不当
  "naturalness",   // 语法对,但不地道
]);

const MasteryType = z.enum([
  "vocab",
  "grammar",
  "collocation",
  "error_pattern",
  "expression_gap", // 母语/混说表达缺口;只用于 gap 情景本身
]);

// 单个错误点。mastery_key 是 upsert 进 SQLite 的稳定键,
// LLM 不需要知道数据库 id,只要对同一类问题始终给同一个 key。
const Issue = z.object({
  category: IssueCategory,
  span_original: z.string(),   // 用户原句里有问题的片段(原样)
  span_corrected: z.string(),  // 该片段改对后的样子
  explanation: z.string(),     // 用【母语】解释为什么错
  severity: z.enum(["minor", "moderate", "major"]),
  mastery_key: z.string(),     // 如 "grammar:article_usage" / "collocation:make_vs_do"
  mastery_label: z.string(),   // 人类可读:"冠词 a/an/the 的用法"
  mastery_type: MasteryType,
});

// 只上报"正面信号"和"新引入项"。
// 错误信号不在这里 —— 由代码从 issues[] 自动派生,避免重复和不一致。
const MasteryUpdate = z.object({
  key: z.string(),
  label: z.string(),
  type: MasteryType,
  signal: z.enum([
    "correct",      // 用户这轮正确用出某个点(尤其之前薄弱的):产出证据
    "introduced",   // 批改/建议里新引入的点:曝光证据,不推动 known
  ]),
  evidence: z.string().optional(), // 用户真实句子,最有价值
});

export const TutorAnalysis = z.object({
  is_correct: z.boolean(),
  corrected: z.string(),               // 用户输入的完整改正版(没错就 = 原句)
  natural: z.string(),                 // 更地道的说法(可能 = corrected)
  issues: z.array(Issue),              // is_correct 为 true 时为空
  mastery_updates: z.array(MasteryUpdate),
  expression_gap: ExpressionGap.nullable(), // 无表达缺口时必须为 null
});

export type TutorAnalysis = z.infer<typeof TutorAnalysis>;
```

> **母语 / 混说输入**走同一个 tutor 调用的扩展契约:`MasteryType` 多一个 `expression_gap`,`TutorAnalysis` 多一个可选 `expression_gap` 块,prompt 多一段 EXPRESSION GAP 检测。完整定义、记账(`gap` 信号)、UI 分流见 **[expression-gap.md](./expression-gap.md)**。本文件下面的 schema / prompt 是「目标语产出错误」这条主链路;实现代码(`src/agents/{schema,tutor}.ts`)是两者合并后的版本。

**为什么错误信号不进 `mastery_updates`:** 每个 `issue` 天然就是一个错误信号,代码遍历 `issues[]` 时按 `mastery_key` 自动生成 `error` 信号即可。让 LLM 再抄一遍只会制造不一致。`mastery_updates` 专门捕捉 `issues` 表达不了的两件事:**用户做对了**(正面证据,推动 struggling→known)和**新引入的点**。

## System Prompt

```text
You are a precise language tutor analyzing a single message from a
{native_language} speaker learning {target_language} at {level} level. You give
structured feedback only — a separate conversation agent handles the chat.

FEEDBACK
- Correct only real errors. Do NOT rewrite acceptable stylistic choices. If
  something is grammatical but unnatural, use severity="minor",
  category="naturalness" — don't treat it as an error.
- Apply the learner experience preferences below. If they say to ignore
  capitalization or punctuation, do NOT create issues or mastery_updates for
  differences that are only capitalization/punctuation. You may normalize those
  details in "corrected" or "natural" when another real issue is present.
- For each error give the smallest wrong span, its fix, and a short explanation
  IN {native_language}.
- Use a consistent lowercase snake_case mastery_key per recurring problem type
  (e.g. "grammar:article_usage"). Same problem ⇒ same key, every time. Reuse the
  keys already present in the weak list below whenever they apply.
- If the message is fully correct: is_correct=true, issues=[].
- "natural" = a more idiomatic rendering (may equal "corrected").

BOOKKEEPING (mastery_updates)
- Do NOT list the user's errors here — those come from issues.
- Add a "correct" signal when the user correctly used something from their weak
  list, or anything notable they got right.
- Add an "introduced" signal for any new word/structure you introduced.

Return ONLY the structured object defined by the schema.
Always include all top-level keys:
is_correct, corrected, natural, issues, mastery_updates, expression_gap.
Use [] for empty arrays and expression_gap:null when there is no gap.

=== LEARNER EXPERIENCE PREFERENCES ===
{experience_preferences}

=== KNOWN WEAK POINTS (reuse these mastery_key values) ===
{weak_list}
```

User message:

```text
=== RECENT CONVERSATION ===
{history}

=== USER MESSAGE TO ANALYZE ===
{user_input}
```

## 代码侧记账(分数归代码管)

LLM 给信号,代码算状态:

```ts
// 每轮:issues → error 信号;mastery_updates → correct / introduced 信号
function applySignal(item, signal) {
  if (signal === "introduced") {
    item.last_seen_at = Date.now(); // 曝光过,但不是用户会用了
    return;
  }

  item.seen_count++;
  if (signal === "error" || signal === "gap") item.error_count++;
  item.last_seen_at = Date.now();

  const errRate = item.error_count / item.seen_count;
  item.status =
    item.seen_count < 3 ? "learning"   :
    errRate > 0.4       ? "struggling" :
    errRate < 0.15      ? "known"      : "learning";
}
```

实现上还会把每条信号写入 `mastery_event`:聚合快照(`mastery_item`)用于查询排序,
事件日志用于审计、合并 key、以后调整公式后重算。

公式以后再调,关键是它在代码里,可测可改,不依赖模型。

## 怎么真正拿到结构化输出

- **OpenAI 兼容**:`response_format: { type: "json_schema", json_schema }`
- **Anthropic**:把 schema 作为单个 tool 的 input_schema,强制调用
- **Gemini**:`responseSchema`,代码把 Zod 的 nullable anyOf 转成 Gemini 的 `nullable:true`
- 三者都用 `zod-to-json-schema` 从上面的 Zod 生成,一份 schema 多处用
- **修复回退**:`TutorAnalysis.safeParse()` 失败后先让模型做一次 JSON repair / re-analyze;仍失败才退回纯文本批改(显示给用户,但本轮不更新 mastery),别让整轮崩掉
