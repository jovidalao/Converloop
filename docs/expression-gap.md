# Expression Gap(母语 / 混说 → 表达缺口)

> [tutor-agent](./tutor-agent.md) 的扩展契约。关联:[architecture](./architecture.md) · [profile-maintainer-agent](./profile-maintainer-agent.md)

## 0. 场景

用户用**母语**输入,或**母语 + 目标语混说**——因为他不知道怎么用目标语表达这个意思。例:

- 「我想说 *I'd like to* 那个…… 怎么委婉地拒绝同事的请求?」
- 「Can you help me 把这个 deadline 往后推几天?」(混说)

## 1. 重框:这不是「错误」,是「缺口」

现有批改模型处理的是 **error**:用户产出了目标语句子但产错了 → 红删除线 + 绿改写 diff。

母语/混说是另一种信号——**gap**:用户**根本没能产出**目标语,退回了母语。它需要:

- **不同的观察**(tutor 报告「想表达什么 + 地道说法 + 模板 + 关键词」,而非「哪个 span 错了」)。
- **不同的记账**(一个 `gap` 信号,而非 `error`)。
- **不同的纠正 UI**(没有原句可 diff,改成「教你怎么说」面板)。

**仍在热路径同一个 tutor 调用里完成,不加第三个 agent**——只是扩展 tutor 的输出契约。tutor 依旧只观察,代码依旧记账。

## 2. Schema(tutor 观察,已落地版)

`TutorAnalysis` 增加一个可选块 `expression_gap`,`MasteryType` 增加一个值 `expression_gap`(`src/agents/schema.ts`):

```ts
const KeyItem = z.object({
  text: z.string(),          // 目标语的词 / 词组 / 句式
  gloss: z.string(),         // 母语释义
  mastery_key: z.string(),   // 复用现有 vocab/collocation/grammar 的稳定键
  mastery_label: z.string(),
  mastery_type: MasteryType, // vocab | collocation | grammar(不在这里用 expression_gap)
});

const ExpressionGap = z.object({
  mastery_key: z.string(),         // 情景/意图稳定键,前缀 "gap:",如 "gap:decline_request_politely"
  mastery_label: z.string(),       // 人类可读:"委婉拒绝请求"
  original: z.string(),            // 用户原句(母语/混说)—— 最重要的练习记录
  target_expression: z.string(),   // 地道的目标语整句  ← headline,也用于延续对话
  template: z.string().optional(),   // 可复用句式模板(空槽 ___)
  explanation: z.string(),         // 讲解:怎么构成这句话的思路 + 句式(母语)
  key_items: z.array(KeyItem),     // 1–3 个关键词/搭配/句式
  usage_note: z.string().optional(), // 什么场景、怎么套用(母语)
});

export const TutorAnalysis = z.object({
  is_correct: z.boolean(),
  corrected: z.string(),
  natural: z.string(),
  issues: z.array(Issue),
  mastery_updates: z.array(MasteryUpdate),
  expression_gap: ExpressionGap.nullable(), // ← 纯目标语输入时必须为 null
});
```

> 设计稿里曾有 `intended_meaning` 字段,**未落库**(意图已隐含在 `original` + `explanation` 里)。

### 共存规则(混说)

- `issues[]` 照常覆盖**目标语部分**的错误(还是红绿 diff)。
- `expression_gap` 覆盖**母语部分**的缺口。二者可同时非空。
- `is_correct` 只针对目标语部分;纯母语输入时 `is_correct=true`、`issues=[]`、`expression_gap` 非空。

### 检测规则(写进 tutor prompt)

tutor 在以下情况填 `expression_gap`:输入整句或部分是母语、或用户显式表示「不知道怎么说 X」。识别意图 → 给地道整句 + 可复用模板(空槽 `___`)+ 1–3 个关键词(稳定 key)+ 母语场景说明。完整 prompt(含 EXPRESSION GAP 段)在 `src/agents/tutor.ts`,改 prompt 记得同步 [tutor-agent.md](./tutor-agent.md) 契约。

### Rust 迁移?——不需要

`mastery_item.type` 是裸 `TEXT`(无 CHECK,见 `src-tauri/src/lib.rs`),新增 `expression_gap` 只改 TS 侧两个 enum(`schema.ts` Zod + `db/schema.ts` drizzle)。

## 3. 记账(代码记账,LLM 不碰计数)

`src/db/mastery-logic.ts`:`SignalKind = "error" | "correct" | "introduced" | "gap"`。

`applySignal` 里 `gap` 与 `error` 一样计入 `errorCount`(用户没能产出 = 负面证据,推向 struggling),但语义上由 `type="expression_gap"` 区分,供对话 agent / 复习知道「这是要让他*产出*的,不是'他老错'」。

```ts
const errorCount = prev.errorCount + (kind === "error" || kind === "gap" ? 1 : 0);
```

**`deriveSignals` 扩展**——`expression_gap` 非空时:

1. **意图本身** → 一个 `expression_gap` 项:`{ key: gap.mastery_key, label: gap.mastery_label, type: "expression_gap", kind: "gap", example: gap.original, note: gap.target_expression }`。
2. **每个 key_item** → `introduced` 信号(曝光证据,不增加 `seen_count`,不推动 known)。

**落库约定:**`mastery_item.example` = 用户原始母语/混说输入;`mastery_item.notes` = 目标语地道表达(`target_expression`);`mastery_event.payload_json` = 完整 `expression_gap` 或 `key_item`,供以后补模板、重算、调试。

**毕业路径:**`gap:` 键只会被记 `gap`(=error),`errorCount==seenCount` 恒为 1 → 永远 struggling。要让它毕业,tutor 在用户后来**主动、用目标语**说出该表达时,对同一个 `gap:` 键发一个 `correct` 信号(`type="expression_gap"`),`seenCount++` 而 `errorCount` 不变 → 走向 known。见 tutor prompt 的 BOOKKEEPING 段。

## 4. 纠正 UI

母语/混说这一轮的 UI 与普通批改**完全分支**(`InlineCorrection.tsx` 按 `analysis.expression_gap` 是否存在分流;气泡角标在 `ChatView.tsx` 的 `UserSentence`):

- **气泡**:原样显示母语/混说文本 + 一个小角标(🌐「母语」)。不做红绿 diff。
- **专属面板**:地道表达(`target_expression`,headline,带朗读)/ 句型模板(`template`,空槽 `___` 高亮)/ 关键词(`key_items` chips,可朗读、hover 显示母语释义)/ 场景(`usage_note`,弱化一行)。
- **混说且目标语部分有错**:旁边照常出现「语法详解」toggle,两者并列。

## 5. 对话延续 + 档案

- **对话延续**:母语轮的历史用导师转换的地道目标语,后续对话在目标语里连贯(`src/db/turns.ts` 的 `userLineForHistory`)。
- **档案**:维护 agent 把 gap 写进 MD profile 的「## Expression gaps / 想说但说不出的情景」区块,对话 agent 据此被动复用。

## 6. 显式复习去哪了(有意收窄)

设计稿曾有独立「每日复习页 + `review_day` 缓存表 + `reviewGenerator` agent」。**没有照原样实现**——显式复习已由**专项课 / Learning Agent**([lessons.md](./lessons.md))承接:内置「今日复盘」「语法专项复习」「表达缺口训练」,新开老师型学习会话,用户在课堂确认「这句算掌握」时回写 `correct` 信号。这样复习产品形态收敛到专项课,不再单独做缓存页。
