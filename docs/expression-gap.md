# Expression Gap(母语 / 混说 → 表达缺口)+ 每日复习页

> 关联:[tutor-agent](./tutor-agent.md) · [architecture](./architecture.md) · [profile-maintainer-agent](./profile-maintainer-agent.md)

## 实现状态(2026-05-30)

**已实现(底层记录 + 对话延续 + 讲解 UI):**

- schema:`ExpressionGap` + `MasteryType="expression_gap"`(`src/agents/schema.ts`)。
- 记账:`SignalKind="gap"`、`deriveSignals` 记情景(存**原句**)+ key_items 走 introduced(`src/db/mastery-logic.ts`、`mastery.ts`,写 `notes`)。
- tutor prompt:母语/混说 → 不语法纠正,改为**讲解构句思路 + 句式**(`src/agents/tutor.ts`)。
- 对话延续:母语轮的历史用导师转换的地道目标语,后续对话在目标语里连贯(`src/db/turns.ts` `userLineForHistory`)。
- 纠正 UI:气泡「母语」角标 + 讲解面板(地道表达 / 讲解 / 关键词句式 / 场景),取代红绿 diff(`InlineCorrection.tsx`)。

**与本文设计稿的差异(有意收窄):**

- 当前 `ExpressionGap` 字段为 `original / target_expression / explanation / key_items / usage_note`(去掉了 `intended_meaning`、`template`——`template` 等做复习页时再加)。
- §5 **每日复习页 + `reviewGenerator` agent + `review_day` 迁移 = 未实现(下一步)**。下方 §5 保留为设计参考。

## 0. 场景

用户用**母语**输入,或**母语 + 目标语混说**——因为他不知道怎么用目标语表达这个意思。例:

- 「我想说 *I'd like to* 那个…… 怎么委婉地拒绝同事的请求?」
- 「Can you help me 把这个 deadline 往后推几天?」(混说)

## 1. 重框:这不是"错误",是"缺口"

现有批改模型处理的是 **error**:用户产出了目标语句子,但产错了 → 红删除线 + 绿改写 diff。

母语/混说是另一种信号——**gap**:用户**根本没能产出**目标语,退回了母语。它需要:

- **不同的观察**(tutor 报告"想表达什么 + 地道说法 + 模板 + 关键词",而不是"哪个 span 错了")
- **不同的记账**(一个 `gap` 信号,而非 `error`)
- **不同的纠正 UI**(没有原句可 diff,所以不是红绿,而是"教你怎么说"面板)
- **单独的复习**(见 §5 每日复习页)

**仍在热路径同一个 tutor 调用里完成,不加第三个 agent**——只是扩展 tutor 的输出契约。tutor 依旧只观察,代码依旧记账(遵守[架构铁律](../CLAUDE.md))。

---

## 2. 检测与 schema(tutor 观察)

`TutorAnalysis` 增加一个**可选块** `expression_gap`(`src/agents/schema.ts`):

```ts
const KeyItem = z.object({
  text: z.string(),          // 目标语的词 / 词组 / 句式
  gloss: z.string(),         // 母语释义
  mastery_key: z.string(),   // 复用现有 vocab/collocation/grammar 的稳定键
  mastery_label: z.string(),
  mastery_type: MasteryType, // vocab | collocation | grammar(不在这里用 expression_gap)
});

// 实际实现版(见顶部"实现状态");template/intended_meaning 留到复习页再加。
const ExpressionGap = z.object({
  mastery_key: z.string(),       // 情景/意图稳定键,如 "gap:decline_request_politely"
  mastery_label: z.string(),     // 人类可读:"委婉拒绝请求"
  original: z.string(),          // 用户原句(母语/混说)—— 最重要的练习记录
  target_expression: z.string(), // 地道的目标语整句  ← headline,也用于延续对话
  explanation: z.string(),       // 讲解:怎么构成这句话的思路 + 句式(母语)
  key_items: z.array(KeyItem),   // 1–3 个关键词/搭配/句式
  usage_note: z.string().optional(), // 什么场景、怎么套用(母语)
});

export const TutorAnalysis = z.object({
  is_correct: z.boolean(),
  corrected: z.string(),
  natural: z.string(),
  issues: z.array(Issue),
  mastery_updates: z.array(MasteryUpdate),
  expression_gap: ExpressionGap.nullable(),  // ← 新增;纯目标语输入时为 null
});
```

`MasteryType` 增加一个值:

```ts
const MasteryType = z.enum([
  "vocab", "grammar", "collocation", "error_pattern",
  "expression_gap",  // ← 新增:一个"想表达但说不出"的情景/意图
]);
```

### 共存规则(混说)

- `issues[]` 照常覆盖**目标语部分**的错误(还是红绿 diff)。
- `expression_gap` 覆盖**母语部分**的缺口。
- 二者可同时非空(混说且目标语部分也有错)。
- `is_correct` 只针对目标语部分;纯母语输入时 `is_correct=true`、`issues=[]`、`expression_gap` 非空。

### 检测规则(写进 prompt,见 §7)

tutor 在以下情况填 `expression_gap`:输入整句或部分是母语、或用户显式表示"不知道怎么说 X"。识别意图 → 给地道整句 + 可复用模板(空槽 `___`)+ 1–3 个关键词(稳定 key)+ 母语场景说明。

### Rust 迁移?——不需要

`mastery_item.type` 是裸 `TEXT`(无 CHECK,见 `src-tauri/src/lib.rs`),新增 `expression_gap` 只改 TS 侧两个 enum(`schema.ts` Zod + `db/schema.ts` drizzle)。复习页的缓存表才需要迁移(§5)。

---

## 3. 记账(代码记账,LLM 不碰计数)

### 新信号种类 `gap`

`src/db/mastery-logic.ts`:

```ts
export type SignalKind = "error" | "correct" | "introduced" | "gap";
```

`applySignal` 里 `gap` 与 `error` 一样计入 `errorCount`(用户没能产出 = 负面证据,推向 struggling),但语义上由 `type="expression_gap"` 区分,供复习页和对话 agent 知道"这是要让他*产出*的,不是'他老错'"。

```ts
const errorCount = prev.errorCount + (kind === "error" || kind === "gap" ? 1 : 0);
```

### `deriveSignals` 扩展

`expression_gap` 非空时:

1. **意图本身** → 一个 `expression_gap` 项:
   `{ key: gap.mastery_key, label: gap.mastery_label, type: "expression_gap", kind: "gap", example: gap.target_expression, note: template + usage_note }`
2. **每个 key_item** → `introduced` 信号(**完全复用**现有 vocab/collocation/grammar 机制,无新逻辑)。

### Signal / 存储扩展

`Signal` 增加可选 `note`,`upsertSignal` 写入 `mastery_item.notes`(列已存在)。这样 `target_expression` 进 `example`、`template`+`usage_note` 进 `notes`,复习页可直接取用。

---

## 4. 纠正 UI(单独设计)

母语/混说这一轮的 UI 与普通批改**完全分支**:

- **气泡**:原样显示母语/混说文本 + 一个小角标(🌐「母语」)。**不做红绿 diff**(没有目标语原句可 strike)。
- **专属面板**(在气泡下方,取代红绿 diff 那套):
  - **地道表达** — `target_expression`,headline,带朗读按钮
  - **句型模板** — `template`,空槽 `___` 高亮样式
  - **关键词** — `key_items` 做成 chips,每个可朗读、hover 显示母语释义
  - **场景** — `usage_note`,弱化的一行
- **混说且目标语部分有错**:旁边照常出现「语法详解」toggle(§ 现有红绿那套),两者并列。

icon 工具条适配:母语轮用一个「表达」图标(Lucide `languages` / `sparkles`),点开就是上面的面板。

> UI 组件:`InlineCorrection.tsx` 里按 `analysis.expression_gap` 是否存在分流;气泡角标在 `ChatView.tsx`(`UserSentence` 已是分流点)。

---

## 5. 每日复习页(新顶层视图)

> 你的要求:**单独一个页面,能生成单独的每天复习的内容。** 这是对 v1"只做被动复用、不做抽认卡"的一次有意扩展。

### 入口与导航

- `MainView` 增加 `"review"`(`Sidebar.tsx`),底部导航加「复习」入口(Lucide `calendar-check` / `repeat`)。
- `App.tsx` 顶栏标题与视图分发加 `review` 分支。

### 数据:按日缓存(需要 Rust 迁移 v5)

```sql
CREATE TABLE IF NOT EXISTS review_day (
    day          TEXT PRIMARY KEY NOT NULL,   -- 本地 YYYY-MM-DD
    generated_at INTEGER NOT NULL,
    content_json TEXT NOT NULL,               -- 生成的复习卡片集合
    done_json    TEXT                          -- 已标记"会了"的卡片 key 集合
);
```

打开复习页 → 查 `review_day` 当天行:有就直接渲染,没有就调生成 agent 生成并落库。提供「换一批/重新生成」。

### 生成来源 + 新 agent `reviewGenerator`

读 **SQLite**(像导师一样,不读 MD):

- 优先 `type="expression_gap"` 且 `status != known` 的情景项(取 `example`=地道说法、`notes`=模板/场景)。
- 补充 `status="struggling"` 的薄弱项。

产出当天复习卡片(结构化 Zod 输出),每张卡片三段,对应你描述的复习节奏:

1. **复习"这句话怎么表达"** — 给意图(母语),让用户回忆/对照 `target_expression`。
2. **模板套用** — 给一个**新的类似情景**,让用户用 `template` 套出一句(主动产出)。
3. **关键词/句式** — 列出该情景的关键 `key_items`。

```ts
const ReviewCard = z.object({
  source_key: z.string(),       // 关联的 mastery_item.key(标记"会了"时回写信号)
  kind: z.enum(["expression_gap", "weak_item"]),
  prompt_native: z.string(),    // 第①段:母语情景/意图
  target_expression: z.string(),// 参考地道说法(可折叠,先隐藏鼓励回忆)
  apply_scenario: z.string(),   // 第②段:新情景,套模板
  template: z.string(),
  key_items: z.array(z.object({ text: z.string(), gloss: z.string() })),
});
const ReviewSet = z.object({ cards: z.array(ReviewCard) });
```

### 交互 → 记账闭环(遵守铁律)

- 用户在卡片上点「会了」→ 产生一个 `correct` 离散信号 → 走现有 `recordAnalysis`/`applySignal` 把对应 `mastery_item` 推向 known。**复习 agent 不碰计数**,用户操作才驱动记账。
- 标记结果写 `review_day.done_json`,当天不重复。

### 与被动复习的关系

不替代、是叠加:对话 agent 仍在聊天里被动复用(maintainer 把 gap 写进 MD profile 的新区块「想说但说不出的情景」)。复习页是**显式、按天、可主动产出**的那一层。

---

## 6. 涉及文件 / 实现任务(build-plan 追加项)

| # | 任务 | 验收 |
|---|------|------|
| A | schema:`ExpressionGap` + `MasteryType=expression_gap` | `tutorJsonSchema()` 含新字段;单测过 |
| B | tutor prompt:加 EXPRESSION GAP 段(§7);prose 回退也加一段 | 母语输入能返回 `expression_gap` |
| C | 记账:`SignalKind=gap`、`applySignal`、`deriveSignals`、`Signal.note`、`upsertSignal` 写 notes | mastery-logic 单测覆盖 gap + key_items |
| D | 纠正 UI:气泡角标 + 专属面板(§4) | 母语/混说轮渲染正确,深色适配 |
| E | 复习页:`review` 视图 + 导航 + `review_day` 迁移(v5) | 打开生成并缓存,换一批可用 |
| F | `reviewGenerator` agent + Zod schema(§5、§8) | 读 SQLite 产出结构化卡片 |
| G | 复习记账闭环:「会了」→ correct 信号 | 点击后 mastery 状态推进、当天去重 |
| H | maintainer:MD 新增「想说但说不出的情景」区块 | gap 进 profile,对话 agent 可被动复用 |

---

## 7. 完整 tutor system prompt(替换 `src/agents/tutor.ts` 的 `systemPrompt`)

```text
You are a precise language tutor analyzing a single message from a
{native_language} speaker learning {target_language} at {level} level. You give
structured feedback only — a separate conversation agent handles the chat.

The user is SUPPOSED to write in {target_language}, but sometimes falls back to
{native_language} (fully or mixed) because they don't know how to say something.
Handle the two cases differently:

A) ERRORS — when the user DID produce {target_language} but got it wrong.
- Correct only real errors. Grammatical-but-unnatural → severity="minor",
  category="naturalness", not an error.
- For each error give the smallest wrong span, its fix, and a short explanation
  IN {native_language}.
- Consistent lowercase snake_case mastery_key per recurring problem (e.g.
  "grammar:article_usage"). Same problem ⇒ same key. Reuse keys from the weak list.
- Fully correct ⇒ is_correct=true, issues=[].
- "natural" = a more idiomatic rendering (may equal "corrected").

B) EXPRESSION GAP — when the message is wholly or partly in {native_language},
   or the user signals they don't know how to say something.
- Set "expression_gap" (otherwise leave it null). Fill:
  - intended_meaning: restate, in {native_language}, what they were trying to say.
  - target_expression: the full idiomatic {target_language} sentence they wanted.
  - template: a reusable pattern with ___ slots they can apply to similar cases.
  - key_items: 1–3 key words/collocations/structures, each with a {native_language}
    gloss and a stable mastery_key (type vocab|collocation|grammar).
  - usage_note (optional): when/how to use it, in {native_language}.
  - mastery_key: a stable key for this *situation/intent*, prefix "gap:"
    (e.g. "gap:decline_request_politely"); mastery_label: human-readable in
    {native_language}.
- MIXED input: still fill issues[] for the {target_language} part AND
  expression_gap for the {native_language} part. is_correct concerns only the
  {target_language} part.

BOOKKEEPING (mastery_updates)
- Do NOT list errors here (they come from issues) and do NOT list expression_gap
  key_items here (handled separately). Only:
  - "correct": user correctly used something notable (esp. from the weak list).
  - "introduced": a new word/structure YOU introduced in feedback.

Never output counts, scores, or confidence — only discrete observations.
Return ONLY the structured object defined by the schema.

=== KNOWN WEAK POINTS (reuse these mastery_key values) ===
{weak_list}
```

(prose 回退模板同样加一段:母语输入时输出「想说的 / 地道说法 / 模板 / 关键词 / 场景」。)

## 8. 复习生成 agent prompt(`reviewGenerator`)

```text
You build today's review for a {native_language} speaker learning
{target_language} at {level} level. You are given items the learner struggles
with — especially "expression gaps" (situations they couldn't say in
{target_language}) and weak points. For each, produce a review card that:

1) recall: restate the situation/intent in {native_language} so they try to
   recall the {target_language} expression themselves;
2) apply: give a NEW similar scenario and have them reuse the template;
3) anchor: list the key words/structures.

Keep it tight (max {n} cards). Reference only the provided items — do not invent
new grammar topics. Output ONLY the structured object.

=== ITEMS ===
{items}   // expression_gap: intent/target/template/usage; weak: label/key/type
```

---

## 9. 开放问题 / 取舍

- **复习页选材权重**:gap 优先,薄弱项补足——具体配比(各取几条、总卡片数)先用常量,后调。
- **「会了」的判定**:v1 用用户自评(点按钮)产生 `correct` 信号;不做自动判分(那要再跑一次 tutor,留到以后)。
- **跨日**:`review_day` 按本地日期;不做连续打卡/streak(超出当前范围)。
