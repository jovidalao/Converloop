# 训练模式(Drill)— drill@1 文档格式与运行时契约

训练中心的每个训练模式(内置的情景演练/听写/跟读/弱项闪练,以及用户自定义的)都由**一份 Markdown 文档**定义:YAML frontmatter 是机器执行的枚举配置,正文 `# Section` 是 prompt 散文。这份文档同时是存储格式(`learning_agent.source_md`,kind="drill")、应用内编辑格式、AI 生成目标、导入/导出格式,以及未来市场的分发格式。

> 实现:`src/drills/`(format/capabilities/render/store/seeds/authoring-spec)。本文件是契约;改一处记得同步另一处。

## 设计不变量(架构铁律的延伸)

1. **正文永远只是 prompt。** frontmatter 枚举决定运行时走哪条代码路径(交互机制/批改/记账/喂数据);正文再怎么写,最多产出一个糟糕的 prompt,碰不到计数、密钥、设置。
2. **代码拥有输出契约。** `[[SAY]]` 严格输出格式、复习项清单(`{{items}}`)、听力弱词喂入、重听降速提示全部由 `render.ts` 按枚举自动拼接;文档中出现 `[[SAY]]` 直接判定为校验错误(防止解析器与防剧透遮罩被改坏)。
3. **LLM 只观察,代码记账。** `mastery` 枚举只在四条现成记账路径中选择(production / review / listening / none);`# Observer` 想写记忆只能走提案 → 用户确认管线,绝无直写。

## 文档格式(drill@1)

```markdown
---
format: lang-agent/drill@1
requires: [observer]        # 用到的扩展能力;核心字段不用列
name: …                     # 英文为标准;locales 提供界面语言
description: …
intro: …                    # 起始页长描述(可选,缺省用 description)
icon: zap                   # 见 src/drills/icons.ts 白名单
locales: { zh-CN: { name: …, description: …, intro: … } }
interaction: chat           # chat | say-hidden | say-visible(UI 机制预设)
setup: topic                # none | topic | review-items(起始页)
grading: tutor              # tutor | standard-answer | none(导师批改)
mastery: production         # production | review | listening | none(记账路由)
hints: off                  # 输入框提示
feed: none                  # none | listening-words(每轮代码喂数据)
observer: { scopes: […], writeback: none|propose }
turnActions: [explain, …]   # 限制(绝不放开)预设的回合按钮
---

# Task        ← 每轮怎么出题/反馈(必填;模板变量 {{setup}} {{items}} {{native_language}} {{target_language}} {{level}})
# Opening     ← AI 开场指令(必填;say 预设由代码追加包裹要求)
# Setup       ← 主题推荐器口味(可选)
# Observer    ← 训练自带并行观察者(可选,能力 observer)
# Report      ← 节末训练报告(可选,能力 report)
```

## 能力注册表与兼容规则(`capabilities.ts`)

每个可自定义介入点 = 注册表一条(frontmatter 字段 + 正文小节 + 给 AI 的规范片段)。校验器、运行时分发、AI 创作规范三者都从这张表生成,永不漂移。三条兼容规则:

1. **同大版本内只做加法**:新能力一律可选 + 默认值复刻旧行为 → 老文档零迁移继续工作。
2. **`requires` 声明 + 未知项降级**:文档声明依赖的扩展能力;应用不认识 `requires` 里的键 → 硬报错("请升级应用");不在 `requires` 里的未知 frontmatter 键/正文节 → 警告并忽略。
3. **破坏性改动升大版本**(drill@2)并配迁移函数。

## 运行时绑定

- **会话修饰符**:`agent_modifiers_json.drill = { modeId, params, def }`。prompt 散文按 modeId 实时解析(编辑训练会影响进行中的会话);机制枚举用创建时的 def 快照(会话形态不会中途变形);训练被删除后回退到快照。旧的 `quickfire/dictation/shadowing/reviewDrill` 键在 `parseAgentModifiers` 读取时归一化为 drill 修饰符,存量行不重写。
- **内置种子**:`src/drills/seeds/*.md` 经 `?raw` 编译进应用,启动时 `ensureBuiltInDrills` 播种;内置行只读(UI 提供「复制为我的训练」),与种子不一致即自愈为最新版。
- **观察者宿主**:`builtin:drill_observer` 是唯一注册的观察者,逐轮检查 `ctx.drill.def.observer` 并按文档声明的 scopes 限定数据;批注落在 `drill:<modeId>:observer` 下。
- **报告**:`generateDrillSessionReport`(orchestrator)对有 `# Report` 的训练在作答 ≥3 轮后提供节末报告条(只读)。

## AI 创建闭环

`authoring-spec.ts` 生成创作规范(说明英文,prompt 标准英文 + locales 多语言适配),三个消费者:① 训练中心「复制 AI 创作规范」→ 用户粘给外部 AI → 粘回导入;② 应用内 `agents/drill-builder.ts`(同一份规范做 system prompt,校验失败自动带错误重试一轮);③ 导入校验器本身。校验错误的措辞设计为可以原样发回给 AI 修正。
