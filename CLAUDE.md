- 下面是完整最终版，可直接作为改进计划报告使用。

  **lang-agent Agent-first 改进计划报告**

  **一、目标**

  把 lang-agent 从“聊天 + 若干硬编码功能”升级为 **Agent-first 语言学习工作台**。

  核心目标不是堆更多 Agent，而是让系统具备：

  1. 任意输入、输出、反馈、记忆、复习、会话动作阶段都可以由 Agent 介入。
  2. 用户和开发者可以创建新的 Agent 能力。
  3. UI 从单纯 ChatGPT 式聊天，升级为“对话现场 + 教练反馈 + 学习记忆 + Agent 动作层”。
  4. 仍然保留当前项目最重要的原则：**LLM 观察，代码记账；Agent 提议，代码验证写入。**

  **二、第一性原理**

  用户使用这个 App 的目的不是“和 AI 聊天”，而是更流畅地学习语言。因此架构和 UI 都应该围绕这几个问题设计：

  1. 我现在在练什么？
  2. AI 是什么角色？我是什么角色？
  3. 我刚才哪里说错了？
  4. 哪些内容被系统记住了？
  5. 我下一步可以怎么练得更好？
  6. 我能否快速改变练习方式，而不是重新解释需求？

  所以新产品形态应是：

  ```text
  语言学习工作台
  = 对话现场
  + 实时教练
  + 学习记忆
  + 可插拔 Agent 能力
  + 可分支的练习场景
  ```

  **三、核心架构方向**

  新增统一的 **Agent Runtime**，把现有硬编码的 Conversation、Tutor、Maintainer、Explain、Bilingual、Learning、Task Agent 逐步迁入统一体系。

  Agent 不再只是“一个 prompt”，而是一个带边界的能力单元：

  ```ts
  AgentDefinition {
    id
    name
    version
    kind
    prompt
    inputSchemaJson?
    outputSchemaJson?
    dataScopes
    allowedTools
    writebackPolicy
    uiAction?
  }
  ```

  再通过 hook 绑定到不同运行阶段：

  ```ts
  AgentHookBinding {
    hook
    agentId
    priority
    conditionJson
    enabled
  }
  ```

  典型 hook：

  ```text
  conversation.before_user_input
  conversation.reply
  conversation.after_reply
  conversation.after_analysis
  conversation.action
  turn.explain
  turn.translate
  profile.maintain
  conversation.idle
  conversation.end
  ```

  **四、Agent 类型**

  | 类型             | 作用                     | 示例                               |
  | ---------------- | ------------------------ | ---------------------------------- |
  | `reply_producer` | 生成主回复，通常流式     | Conversation Agent                 |
  | `observer`       | 并行观察，输出结构化信号 | Tutor Agent、表达缺口 Agent        |
  | `transformer`    | 转换已有文本             | 双语阅读、讲解、改写               |
  | `action`         | 用户点击按钮触发         | 第二天继续、调换角色、提高难度     |
  | `background`     | 后台维护                 | Profile Maintainer、摘要、Key 审计 |

  热路径中仍应限制：**一个主回复 Agent + 多个并行 observer**。其他 Agent 后台运行或按需运行，避免拖慢首 token。

  **五、写入边界**

  开放的是 Agent 编排能力，不是数据库自由写入能力。

  Agent 可以：
  - 读取被授权的数据 scope。
  - 输出结构化建议。
  - 创建 UI 展示内容。
  - 提出 memory / mastery / profile 修改建议。

  Agent 不可以：
  - 直接改 mastery 计数。
  - 直接写 SQLite 任意表。
  - 直接改 API key、provider、系统设置。
  - 绕过代码验证写入学习记忆。

  建议权限模型：

  | 权限                         | 说明                                     |
  | ---------------------------- | ---------------------------------------- |
  | `profile.read`               | 读学习者档案切片                         |
  | `mastery.read`               | 读薄弱项 / 复习项                        |
  | `conversation.read`          | 读当前会话历史                           |
  | `turn.annotate`              | 给某轮添加注释或面板结果                 |
  | `profile.propose_patch`      | 提出档案修改                             |
  | `mastery.propose_signal`     | 提出 error / correct / gap / review 信号 |
  | `conversation.create_branch` | 创建分支会话                             |
  | `learning_agent.create`      | 创建专项课草案                           |

  **六、新 UI 方向**

  现有界面不应继续只是“左侧会话 + 中间聊天”。Agent-first 后，主界面建议改为学习工作台。

  推荐桌面布局：

  ```text
  左侧：Sessions / Projects / Lessons / Agents
  中间：Conversation Stage
  右侧：Coach Panel
  ```

  移动端可变为：
  - 聊天为主。
  - Coach Panel 变成底部抽屉。
  - Agent 动作放入会话顶部菜单。

  **七、Conversation Stage**

  中间区域仍是对话主场，但顶部增加会话状态条：

  ```text
  场景：咖啡店闲聊
  角色：你=顾客 / AI=店员
  难度：B1+
  模式：自然对话
  ```

  状态条旁边提供高频 Agent Action：

  - 第二天继续
  - 重新开始
  - 从此处分支
  - 调换角色
  - 提高难度
  - 降低难度
  - 变成专项课

  这些按钮背后都是 `conversation.action` Agent，但用户看到的是自然学习动作，不是技术插件。

  **八、Coach Panel**

  右侧 Coach Panel 是新体验的关键。它承接现在散落在气泡下方的批改、讲解、记忆写入和下一步建议。

  建议分区：

  ```text
  本轮反馈
  - 错误
  - 更自然说法
  - 表达缺口
  - 可朗读版本
  
  学习记忆
  - 已记录的 mastery item
  - 待确认的记忆修改
  - 被忽略的问题
  
  下一步
  - 针对这个错误练 3 句
  - 用更高难度继续
  - 换角色再来一遍
  - 变成专项课
  ```

  核心原则：**凡是写入学习记忆的事情，用户都应该看得见。**

  **九、分支式会话**

  “重新开始”“第二天开始”“调换角色”“更高难度”不应该破坏原会话，而应该创建分支。

  建议新增 conversation branch 概念：

  ```ts
  conversation {
    parentConversationId?
    branchSourceTurnId?
    branchKind?
    scenarioStateJson?
    agentModifiersJson?
  }
  ```

  用户可以看到：

  ```text
  原始对话
  ├─ 第二天继续
  ├─ 调换角色版
  └─ 高难度版
  ```

  这很适合语言学习，因为同一场景可以重复练，但每次练习目标不同。

  **十、Agent 能力库**

  新增 `Agents / 能力库` 页面。普通用户看到“能力”，开发者才看到 hook、schema、prompt。

  能力卡片显示：

  ```text
  名称
  它做什么
  什么时候运行
  能读什么数据
  是否会提出写入学习记忆
  是否需要确认
  启用 / 禁用
  ```

  例如：

  ```text
  表达缺口捕捉
  运行时机：每轮输入后
  读取：当前输入、最近几轮
  写入：提出 expression_gap 记录
  确认策略：自动写入 / 每次确认
  ```

  **十一、自定义 Agent 创建器**

  不要让用户直接写 JSON。用向导创建：

  1. 这个 Agent 想帮你做什么？
  2. 它什么时候出现？
  3. 它能读什么？
  4. 它输出什么？
  5. 是否允许提出写入？
  6. 是否显示成按钮？

  底层再生成 `agent_definition + hook_binding`。

  开发者可以导入本地 Agent package：

  ```text
  my-agent/
    agent.json
    prompt.md
    output.schema.json
    README.md
    examples.json
  ```

  第一版只开放 prompt/schema 型 Agent，不开放任意代码执行。

  **十二、适合 Agent 化的能力**

  优先支持这些能力：

  1. 纠错 Agent：现有 Tutor Agent。
  2. 表达缺口 Agent：母语 / 混说输入转成可学习表达。
  3. 难度调节 Agent：根据表现建议升降难度。
  4. 场景导演 Agent：维护角色、人设、场景进展。
  5. 复习注入 Agent：决定本轮自然复用哪个薄弱项。
  6. 会话分支 Agent：第二天继续、调换角色、重新开始。
  7. 练习生成 Agent：从某个错误生成 3 句练习。
  8. 会话收尾 Agent：总结今天、更新档案建议。
  9. Mastery Key 审计 Agent：后台发现重复 key 并提出合并。
  10. 专项课生成 Agent：把普通会话变成定制课程。

  **十三、数据模型建议**

  新增或演进：

  ```text
  agent_definition
  agent_hook_binding
  agent_run
  agent_action
  agent_artifact
  conversation_branch
  turn_annotation
  memory_proposal
  ```

  其中：

  - `agent_run` 记录每次运行的输入、输出、错误、耗时、token、关联 turn。
  - `agent_artifact` 保存 Agent 生成的练习、报告、讲解结果。
  - `memory_proposal` 保存“建议写入学习记忆”的待确认内容。
  - `turn_annotation` 保存某轮上的 Agent 结果，不污染主 turn 数据。

  现有 `learning_agent` 可以先保留，作为 `agent_definition(kind="lesson")` 的特例，后续再迁移。

  **十四、迁移路线**

  第 1 阶段：Agent Runtime 骨架  
  - 新增 AgentDefinition / HookBinding / AgentRun。
  - 把现有 Conversation、Tutor、Explain 包装成内置 Agent。
  - 行为不变，测试不回退。

  第 2 阶段：新 Chat 工作台 UI  
  - 中间 Conversation Stage。
  - 右侧 Coach Panel。
  - 顶部会话状态条。
  - 批改、自然表达、记忆写入集中到右侧。

  第 3 阶段：会话动作 Agent  
  - 第二天继续。
  - 重新开始。
  - 从此处分支。
  - 调换角色。
  - 提高 / 降低难度。
  - 新增 conversation branch 数据结构。

  第 4 阶段：Agent 能力库  
  - 显示内置 Agent。
  - 支持启用 / 禁用。
  - 展示权限、运行时机、写入策略。
  - 提供 Agent run 日志。
  - 能力可编辑：自定义 Agent 可改名称/说明/prompt/数据范围/写入策略；内置「对话衍生」Agent
    可改名称/说明/prompt(目标指令)，并支持「恢复默认」。内置改写存 localStorage(前端偏好),
    不进 SQLite、不碰计数/密钥/provider；运行时在派发处实时合并。

  第 5 阶段：自定义 Agent  
  - 用户通过向导创建 prompt 型 Agent。
  - 支持按钮类 Agent 和 observer 类 Agent。
  - 支持 output schema 校验。

  第 6 阶段：开发者 Agent package  
  - 支持导入 / 导出。
  - 提供 examples。
  - 加权限审查和版本管理。

  **十五、验收标准**

  1. 普通聊天首 token 速度不明显变慢。
  2. 新增一个 observer Agent 不需要修改 `runTurn` 主逻辑。
  3. 新增一个按钮类 Agent 不需要修改 ChatView 主结构。
  4. 每次 Agent 运行都有日志可追踪。
  5. Agent 写入学习记忆前有代码验证。
  6. 用户能清楚看到系统记住了什么。
  7. “第二天继续 / 调换角色 / 更高难度”能创建分支而不是破坏原会话。
  8. 现有 Tutor mastery 记账逻辑保持稳定。
  9. 自定义 Agent 不能直接改计数、密钥、provider 设置。
  10. UI 上用户感知的是学习动作，不是技术 hook。

  **十六、最终产品形态**

  最终 lang-agent 应该从：

  ```text
  一个带纠错功能的 AI 聊天 App
  ```

  进化成：

  ```text
  一个本地优先、可扩展、可记忆、可编排的语言学习 Agent 工作台。
  ```

  它的差异化不在于“能聊天”，而在于：

  - 会观察用户真实语言能力。
  - 会把错误和表达缺口变成长期记忆。
  - 会主动安排复习和练习。
  - 会允许用户用自然动作改变练习场景。
  - 会让开发者基于统一 Agent 架构扩展新能力。
  - 会让用户始终知道：AI 做了什么、记住了什么、下一步该怎么练。
