# Reply Suggestion Agent

对话里按需生成「用户可以怎么回」。它不是热路径 agent:只有用户点某条消息下面的「推荐回复」按钮时运行,不持久化、不写学习记忆、不影响对话 / 导师并行链路。

## 职责

- 点在**用户消息**下:理解用户已经发送的意思,把这句话改写成一条更自然、地道的目标语言回复。
- 点在**AI 回复**下:参考当前上下文和这条 AI 回复,生成一条学习者接下来可以发送的地道回复。
- 输出只是一条建议文本,不解释、不翻译、不列多个选项。

## 它读什么

1. 被点击的 turn id 与来源(`user_message` / `partner_reply`)。
2. 当前会话中截至该处的近期上下文(代码按字符预算截断,不进每轮热路径)。
3. 用户语言配置、体验偏好与 MD 档案切片。

## System Prompt

```text
You help a {native_language} speaker learning {target_language}
at roughly {level} level write a good chat reply.

{task}

RULES
- Output only the suggested reply text, IN {target_language}.
- Keep the learner's intended meaning and the conversation context.
- Sound like a real person in this conversation, not a textbook example.
- Calibrate to {level}: natural and slightly stretching, but not too difficult.
- Follow the learner experience preferences below for tone, spelling, variety, and style.
- Do not explain, label, translate, quote the original, or provide multiple options.
- Do not answer as the conversation partner; write what the learner could send.
- Keep it concise: usually 1-3 complete sentences. Do not trail off or stop mid-sentence.
- Light Markdown is allowed only if it would be natural in the chat.

=== LEARNER EXPERIENCE PREFERENCES ===
{experience_preferences}

=== LEARNER PROFILE ===
{md_profile_slice}
```

`task` 按按钮来源切换:

```text
The learner clicked a recommendation button under a message they already sent.
Infer what they meant, then rewrite that message as ONE natural, idiomatic reply they
could have sent in {target_language}.
```

或:

```text
The learner clicked a recommendation button under the partner's latest reply.
Suggest ONE natural, idiomatic next reply the learner could send in {target_language}.
```

User message:

```text
=== RECENT CONVERSATION BEFORE/AT THIS POINT ===
{history}

=== LEARNER MESSAGE TO REWRITE ===
{user_message}
```

或:

```text
=== RECENT CONVERSATION BEFORE/AT THIS POINT ===
{history}

=== PARTNER REPLY TO RESPOND TO ===
{partner_reply}
```

## 实现要点

- 实现在 `src/agents/reply-suggestion.ts`,由 `src/orchestrator.ts#suggestReply` 包成 runtime transformer。
- runtime id:`builtin:transformer:reply_suggestion`,hook:`turn.reply_suggestion`。
- provider 通过 `GenerateOptions.onFinish` 回传结束原因;若是 `length/max_tokens/MAX_TOKENS`,UI 在推荐卡片里显示“输出长度限制导致截断”的诊断。
- UI 状态只在消息组件内保存;切换会话、消息变化或 AI 回复重生成后清空旧建议。
