# Learning Agent(专项课)

定制化学习 Agent 是普通练习对话之外的一类会话,产品名叫**专项课**。它新开一个
conversation,但不走普通 Conversation Agent + Tutor Agent 的热路径;它走一个老师型
system prompt,可以用母语讲解,也可以用目标语言出练习。

## 职责

- 主动带一节聚焦课程:总结相关学习数据、解释关键模式、给小练习。
- 支持内置专项课:今日复盘、语法专项复习、表达缺口训练。
- 支持用户自然语言创建自己的专项课 Agent,再手动微调 prompt。
- 学习会话里用户可以用母语提问或回答,不要把所有输入都当目标语产出。

## 它读什么

专项课只读代码明确拼好的数据上下文,不直接查库:

- `profile`:学习者档案切片
- `weak_all`:当前薄弱项
- `weak_grammar`:语法 / 错误模式 / 搭配薄弱项
- `expression_gaps`:表达缺口
- `today_turns`:今日或最近练习内容
- `due_review`:久未重温的复习项
- `proficiency`:近期难度校准读数

具体每个 Agent 能读哪些 scope 由 `learning_agent.data_scope_json` 决定。

## System Prompt

```text
You are a dedicated teacher for a customized language-learning session called "{agent_name}".
The learner is a {native_language} speaker learning {target_language} at roughly {level} level.

BASE RULES
- This is NOT the normal free conversation mode. You are a teacher leading a focused lesson.
- You may use {native_language} for explanations, planning, summaries, and feedback when it helps. Use {target_language} for examples, drills, and learner production.
- Do not assume every learner message is target-language practice; in this mode the learner may ask questions or answer in either language.
- Give correction and coaching directly in the chat. There is no separate correction panel in this mode.
- Use the learner data below as grounding. Do not claim access to data that is not shown.
- Start with the most useful next step, then ask the learner to do something small and concrete.
- Keep the lesson focused and interactive. Avoid long generic lectures.

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

## 实现要点

- DB:`learning_agent` 表保存内置和自定义 Agent。内置 Agent 缺失时 seed;启动时若某行仍等于历史发布版(`supersedes`,即用户没改过)则升级到最新种子,用户微调过的行保持不动。
- 内置「今日复盘」「语法专项复习」的首条消息(kickoff)先输出一份结构化的详细报告(今日练习复盘 / 语法体检),再过渡到练习。
- DB:`conversation.kind="learning_agent"` + `conversation.learning_agent_id` 区分专项课会话。
- Orchestrator:学习会话调用 `runLearningAgent`,不调用普通 Tutor Agent,因此不显示普通批改面板、不写 mastery 计数。
- 首次打开空的专项课会话时,ChatView 自动调用 `startLearningSession`,让老师先开场。
- 自定义创建走 `learning-agent-builder`:LLM 只生成 name / description / prompt / data scopes,代码落库。

## 数据页自然语言修改

数据页底部的自然语言修改不是让 LLM 直接写数据库。流程是:

1. `data-editor` 把用户请求转成有限操作:`create` / `update` / `delete`。
2. 代码执行这些操作,并明确禁止修改计数。
3. `known` 状态仍走 `markMasteryKnown`,其它状态走手动状态更新。
