# Task Agent(学习项目规划)

Task Agent 是普通练习和专项课之外的**任务 / 项目层**。它借鉴 OpenClaw 通用
Agent 的 workspace + job + bounded tools 思路,但在本项目里做了收窄:只把用户的
开放式学习需求转成一个可读学习项目和若干专项课草案,不进入普通对话热路径,也不直接
修改掌握计数。

## 职责

- 把多样化学习需求转成一个 `learning_project`:目标、计划、备注、下一步。
- 生成最多 3 个可复用的 `learning_agent` 草案,作为项目里的专项课入口。
- 把每次规划记录到 `agent_job`,让后台 agent 调用可追踪、可审计。

## 边界

- **不跑工具循环。** 现阶段只有一次结构化生成,再由代码落库。
- **不写 mastery。** Task Agent 不能创建 error/correct/gap 信号,更不能改计数。
- **不碰 MD 档案。** 长期叙述状态仍由 Profile Maintainer 写。
- **不改 provider / key / 设置。** 它只处理学习计划和课程草案。

这使它可以承接“我下个月要面试”“我想系统练商务邮件”“我最近总说不出某类表达”
这类跨多轮、多课型的需求,同时不破坏原有铁律:

> 对话 agent 读 MD,导师 agent 读 SQLite;代码写 SQLite,维护 agent 写 MD。

## 数据模型

### `agent_job`

```ts
{
  id: string
  kind: string                  // e.g. learning_project_plan
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  input_json?: string
  output_json?: string
  error?: string
  source: 'task_agent' | 'maintainer' | 'summary' | 'manual'
  created_at: number
  updated_at: number
  started_at?: number
  finished_at?: number
}
```

`runTrackedAgentJob` 负责 pending → running → succeeded/failed 的状态转换。后续
维护 agent、摘要 agent、课堂回写 agent 都可以复用这张表。

### `learning_project`

```ts
{
  id: string
  title: string
  goal: string
  status: 'active' | 'completed' | 'archived'
  plan_md: string
  notes_md: string
  source_prompt?: string
  task_plan_json?: string
  created_at: number
  updated_at: number
}
```

学习项目是 workspace-like artifact:它保存计划和原始 Task Agent 输出,但不拥有普通对话
历史。具体练习仍由项目生成的专项课会话承担。

### `learning_agent` 课程包元数据

`learning_agent` 在原有 name / description / prompt / data scopes 之外新增:

```ts
{
  version: number
  allowed_tools_json: string       // v1 只有 ["read_learning_data"]
  writeback_policy: 'none' | 'propose_review_signals'
  output_schema_json?: string
}
```

v1 的 Task Agent 创建的专项课默认:

- `allowed_tools_json=["read_learning_data"]`
- `writeback_policy="none"`
- `output_schema_json=null`

这给未来“课堂完成度回写”留出包级声明,但当前仍保持不回写 mastery。

## 输出 Schema

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

代码把 `suggested_lessons[]` 转成 `LearningAgentDraft[]`,并显式附上课程包边界:
`allowedTools=["read_learning_data"]`,`writebackPolicy="none"`。

## System Prompt

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

## 编排流程

`orchestrator.createLearningProjectFromGoal`:

1. 读取 provider 和语言配置。
2. 创建 `agent_job(kind="learning_project_plan", source="task_agent")`。
3. 调用 `planLearningProject` 生成结构化计划。
4. 代码创建 `learning_project`。
5. 代码创建最多 3 个 `learning_agent` 草案。
6. job 写入 succeeded / failed。

UI 入口在 `LearningAgentsView`:用户输入一个较大的学习目标后,系统生成项目并把新专项课加入
左侧“定制化学习”。

## 后续方向

- 项目详情页:显示 `plan_md`、关联专项课、项目笔记和完成状态。
- 课堂完成度闭环:在课程包 `writeback_policy` 明确允许时,由代码把用户确认的“会了”
  转成 review/correct 信号。
- 更强任务层:可以把 maintainer / summary / writeback 都接入 `agent_job`,但每个 agent
  仍需声明允许读写的边界。
