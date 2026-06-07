# 学习项目与专项课

普通练习对话之外的「任务 / 项目层」+「专项课」子系统:

- **Task Agent / 学习项目** — 把用户开放式学习需求规划成一个可读 `learning_project` + 若干专项课草案。
- **Learning Agent / 专项课** — 一类老师型会话:新开 conversation,但不走普通对话 ∥ 导师热路径,可母语讲解、出练习。

两者耦合:Task Agent 生成的草案就是 Learning Agent 的专项课。表结构(`learning_project` / `learning_agent` / `agent_job`)的字段定义见 [architecture.md#sqlite-schema](./architecture.md#sqlite-schema),本文只讲行为契约,不重复字段。

---

## Task Agent(学习项目规划)

借鉴 OpenClaw 通用 Agent 的 workspace + job + bounded tools 思路,但收窄:只做一次结构化生成,把开放式需求转成项目 + 草案,不进热路径,也不碰掌握计数。

### 职责

- 把多样化学习需求转成一个 `learning_project`:目标、计划、备注、下一步。
- 生成最多 3 个可复用的 `learning_agent` 草案,作为项目里的专项课入口。
- 每次规划记录到 `agent_job`(`source="task_agent"`),可追踪、可审计。

### 边界

- **不跑工具循环。** 只有一次结构化生成,再由代码落库。
- **不写 mastery。** 不能创建 error/correct/gap 信号,更不能改计数。
- **不碰 MD 档案。** 长期叙述状态仍由 Profile Maintainer 写。
- **不改 provider / key / 设置。**

这让它能承接「我下个月要面试」「想系统练商务邮件」「最近总说不出某类表达」这类跨多轮、多课型的需求,而不破坏铁律:对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。

### 输出 Schema

实现见 `src/agents/task-agent.ts`:

```ts
const SuggestedLesson = z.object({
  name: z.string().min(1).max(24),
  description: z.string().min(1).max(80),
  prompt: z.string().min(80),
  data_scopes: z.array(z.enum(LEARNING_DATA_SCOPE_VALUES)).min(1),
});

export const GeneratedLearningProject = z.object({
  title: z.string().min(1).max(40),
  goal: z.string().min(1).max(300),
  plan_markdown: z.string().min(1),
  notes_markdown: z.string().optional(),
  suggested_lessons: z.array(SuggestedLesson).max(3),
  next_actions: z.array(z.string()).max(6),
});
```

代码把 `suggested_lessons[]` 转成 `LearningAgentDraft[]`,并显式附上课程包边界:`allowedTools=["read_learning_data"]`、`writebackPolicy="none"`、`outputSchema=null`。这给未来「课堂完成度回写」留出包级声明,但当前不回写 mastery。

### System Prompt

```text
You are a bounded task-planning agent for a desktop language-learning app.
The learner is a {native_language} speaker learning {target_language} at roughly {level} level.

Your job is to turn a broad learning need into:
- one concrete learning project,
- a readable study plan,
- up to 3 reusable customized lesson agents that the app can create.

Available data scopes for suggested lesson agents:
{scope_list}

Hard boundaries:
- Return JSON only.
- Do not ask to directly edit mastery counts, hidden app state, files, settings, or API keys.
- Do not claim tool access. Suggested lessons may only read the listed learning data scopes.
- Keep the plan practical for chat-based language learning, not flashcards or a full LMS.
- Use {native_language} for project planning notes; use {target_language} for examples or drills where useful.
- Each suggested lesson prompt must be interactive: explain briefly, ask the learner to produce language, and give feedback in chat.
- If the user request is broad, create a staged plan instead of trying to solve everything in one lesson.
```

User message:

```text
Create a learning project from this user need:
{description}
```

### 编排流程

`orchestrator.createLearningProjectFromGoal`:

1. 读 provider + 语言配置。
2. 创建 `agent_job(kind="learning_project_plan", source="task_agent")`。
3. 调 `planLearningProject` 生成结构化计划。
4. 代码创建 `learning_project`。
5. 代码创建最多 3 个 `learning_agent` 草案。
6. job 写 succeeded / failed(`runTrackedAgentJob` 负责状态转换,维护/摘要/回写 agent 都可复用这张表)。

UI 入口在 `LearningAgentsView`:用户输入较大学习目标 → 系统生成项目并把新专项课加入左侧「定制化学习」。

### 后续方向

- 项目详情页:显示 `plan_md`、关联专项课、笔记和完成状态。
- 课堂完成度闭环:在课程包 `writeback_policy` 明确允许时,由代码把用户确认的「会了」转成 review/correct 信号。

---

## Learning Agent(专项课)

定制化学习 Agent,产品名**专项课**。新开一个 conversation,但走老师型 system prompt,不走普通 Conversation ∥ Tutor 热路径。

### 职责

- 主动带一节聚焦课程:总结相关学习数据、解释关键模式、给小练习。
- 内置专项课:今日复盘、语法专项复习、表达缺口训练。
- 支持用户自然语言创建自己的专项课 Agent,再手动微调 prompt。
- 支持由 Task Agent 从较大学习目标生成草案。
- 课堂里用户可用母语提问或回答,不要把所有输入都当目标语产出。

### 它读什么

专项课只读代码明确拼好的数据上下文,不直接查库。可读 scope 由 `learning_agent.data_scope_json` 决定:

- `profile` 档案切片 · `comfortable` 已掌握脚手架 · `weak_all` 薄弱项 · `weak_grammar` 语法/错误模式/搭配薄弱项 · `expression_gaps` 表达缺口 · `today_turns` 今日/最近练习 · `due_review` retention 已衰减最该重温的项 · `proficiency` 近期难度校准读数。

### System Prompt

```text
You are a dedicated teacher for a customized language-learning session called "{agent_name}".
The learner is a {native_language} speaker learning {target_language} at roughly {level} level.

BASE RULES
- This is NOT the normal free conversation mode. You are a teacher leading a focused lesson.
- You may use {native_language} for explanations, planning, summaries, and feedback when it helps. Use {target_language} for examples, drills, and learner production.
- Do not assume every learner message is target-language practice; in this mode the learner may ask questions or answer in either language.
- Give correction and coaching directly in the chat. There is no separate correction panel in this mode.
- Follow the learner experience preferences below for language variety, spelling,
  phrasing, tone, and correction strictness.
- Use the learner data below as grounding. Do not claim access to data that is not shown.
- When drilling a point from the learner data, anchor the exercise to one specific
  item or expression from that data. Refer to it by human label/example, not raw key.
- Start with the most useful next step, then ask the learner to do something small and concrete.
- Keep the lesson focused and interactive. Avoid long generic lectures.

LEARNER EXPERIENCE PREFERENCES
{experience_preferences}

CUSTOM LESSON PROMPT
{agent_prompt}

=== AVAILABLE LEARNER DATA ===
{data_context}
```

User message:

```text
=== RECENT LESSON CONVERSATION ===
{history}

=== LATEST LEARNER MESSAGE ===
{user_input_or_kickoff_instruction}
```

### 实现要点

- DB:`learning_agent` 表保存内置和自定义 Agent。内置缺失时 seed;启动时若某行仍等于历史发布版(`supersedes`,即用户没改过)则升级到最新种子,用户微调过的行保持不动。
- `conversation.kind="learning_agent"` + `conversation.learning_agent_id` 区分专项课会话。
- Orchestrator:学习会话调 `runLearningAgent`,不调普通 Tutor Agent,因此不显示批改面板、不写 mastery 计数。
- 内置「今日复盘」「语法专项复习」的 kickoff 先输出结构化报告(今日复盘 / 逐条讲解最近的语法问题),再过渡到练习;语法课随后逐个击破。
- 首次打开空的专项课会话时,ChatView 自动调 `startLearningSession`,让老师先开场。
- 课堂回写:用户消息下的「这句算掌握」动作运行一次有界 `lesson_writeback` observer,只允许从现有候选 mastery item 选 `correct` 信号,再由代码写 `mastery_event(source="review")` + `mastery_item` 快照。
- 自定义创建走 `learning-agent-builder`:LLM 只生成 name / description / prompt / data scopes,代码落库。

### 数据页自然语言修改

数据页底部的自然语言修改不是让 LLM 直接写库:

1. `data-editor` 把用户请求转成有限操作:`create` / `update` / `delete`。
2. 代码执行,明确禁止修改计数。
3. `known` 状态走 `markMasteryKnown`,其它状态走手动状态更新。
