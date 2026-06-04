// 内置 Agent(Phase 1):把现有 converse / runLearningAgent / tutor 包成 Runtime Agent
// 并在本模块求值时自注册。行为与迁移前的 orchestrator 一致,只是「谁调用它」换成了 Runtime。
// 从 ./index 的副作用 import 触发注册。

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { converse } from "../agents/conversation";
import { runLearningAgent } from "../agents/learning";
import { generateLearningAgentDraft } from "../agents/learning-agent-builder";
import { parseLLMJson } from "../agents/parse-llm-json";
import { analyze } from "../agents/tutor";
import { getProvider, loadConfig } from "../config";
import {
  type AgentModifiers,
  type BranchKind,
  createConversation,
  formatModifierInstructions,
  getConversation,
  type NewConversationContext,
} from "../db/conversations";
import { createLearningAgent } from "../db/learning-agents";
import { recordAnalysis } from "../db/mastery";
import { formatTurns, getTurnsAfterId, updateTurnAnalysis } from "../db/turns";
import { logError } from "../lib/log";
import { maybeRunMaintainer } from "../profile/maintainer-runner";
import { getBuiltinActionOverride } from "./builtin-overrides";
import {
  registerAction,
  registerObserver,
  registerReplyProducer,
  registerTransformer,
} from "./registry";
import type {
  ActionAgent,
  DerivationContext,
  LearningContext,
  Observer,
  PracticeContext,
  ReplyProducer,
  TransformerInfo,
} from "./types";

const NewConversationContextSchema = z.object({
  title: z.string().min(1).max(60),
  scenario: z.string().min(1),
  user_role: z.string().min(1),
  ai_role: z.string().min(1),
  difficulty: z.string().min(1),
  continuity_summary: z.string().default(""),
  opening_instruction: z.string().min(1),
  constraints: z.array(z.string()).default([]),
});

function derivationJsonSchema(): {
  name: string;
  schema: Record<string, unknown>;
} {
  const raw = zodToJsonSchema(NewConversationContextSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete raw.$schema;
  return { name: "NewConversationContext", schema: raw };
}

function parseDerivationOutput(raw: string): NewConversationContext {
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = NewConversationContextSchema.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(
      `对话衍生上下文校验失败: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const data = validated.data;
  return {
    title: data.title,
    scenario: data.scenario,
    userRole: data.user_role,
    aiRole: data.ai_role,
    difficulty: data.difficulty,
    continuitySummary: data.continuity_summary,
    openingInstruction: data.opening_instruction,
    constraints: data.constraints,
  };
}

async function deriveConversationContext(
  ctx: DerivationContext,
  action: {
    label: string;
    objective: string;
  },
): Promise<NewConversationContext> {
  const provider = await getProvider();
  if (!provider) throw new Error("未配置 API key,请到设置页填写");
  const config = loadConfig();
  const [sourceConversation, turns] = await Promise.all([
    getConversation(ctx.sourceConversationId),
    getTurnsAfterId(ctx.sourceConversationId, null),
  ]);
  const sourceTitle = sourceConversation?.title?.trim() || "当前对话";
  const selectedTurn = ctx.sourceTurnId
    ? turns.find((t) => t.id === ctx.sourceTurnId)
    : null;
  const selectedBlock = selectedTurn
    ? `\n=== SELECTED SOURCE TURN ===\nUser: ${selectedTurn.userInput}\nPartner: ${selectedTurn.reply}\n`
    : "";
  const messages = [
    {
      role: "system" as const,
      content: `You are a Conversation Derivation Agent for a language-learning app.

Your job is to read an existing conversation and create a NEW conversation context.
The app has already pushed the user into the new conversation page. After your output,
the normal conversation partner will use your context to open the new conversation.

Rules:
- Return JSON only.
- Do not continue the old chat directly; design the hidden context for a fresh conversation.
- Preserve useful persona, scenario, and continuity from the source conversation when relevant.
- Keep the new context practical for spoken/written language practice.
- Do not ask to change model keys, provider settings, hidden counters, or raw database state.
- The opening_instruction should tell the conversation partner how to start naturally.
- Use concise fields; the user should feel the new conversation starts immediately, not as a report.`,
    },
    {
      role: "user" as const,
      content: `=== ACTION ===
${action.label}

=== ACTION OBJECTIVE ===
${action.objective}

=== LANGUAGES ===
Native: ${config.nativeLanguage}
Target: ${config.targetLanguage}
Level: ${config.level}

=== SOURCE CONVERSATION TITLE ===
${sourceTitle}
${selectedBlock}
=== SOURCE CONVERSATION ===
${formatTurns(turns) || "(empty conversation)"}`,
    },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0.3,
    maxTokens: 1400,
    jsonSchema: derivationJsonSchema(),
    meta: { label: `conversation_derivation:${action.label}` },
  });
  return parseDerivationOutput(raw);
}

// 普通对话主回复。读 MD 切片 + 复习候选 + 校准,流式秒回。
const conversationReply: ReplyProducer = {
  id: "builtin:conversation",
  kind: "reply_producer",
  conversationKind: "practice",
  card: {
    title: "对话伙伴",
    description: "用目标语言自然回复、延续对话,不纠错(纠错交给导师)。",
    timing: "每轮 · 热路径 · 流式",
    reads: "MD 档案切片 · 复习候选 · 难度校准 · 会话调节",
    writes: "无(只产出回复文本)",
    canDisable: false,
  },
  run: (ctx, onDelta) => {
    const c = ctx as PracticeContext;
    return converse(
      ctx.provider,
      {
        ...ctx.langs,
        experiencePreferences: c.conversationPreferences,
        profileSlice: c.profileSlice,
        reviewItems: c.reviewItems,
        calibrationHint: c.proficiency.calibrationHint,
        sessionAdjustments: formatModifierInstructions(c.agentModifiers),
        summary: ctx.summary,
        history: ctx.history,
        userInput: ctx.userInput,
        openingInstruction: ctx.openingInstruction,
      },
      onDelta,
    );
  },
};

// 专项课主回复。老师型 prompt + 有界数据 scope;不跑导师。
const learningReply: ReplyProducer = {
  id: "builtin:learning",
  kind: "reply_producer",
  conversationKind: "learning_agent",
  card: {
    title: "专项课老师",
    description: "按课程 prompt 和有界学习数据,上老师型专项课。",
    timing: "专项课每轮 · 流式",
    reads: "授权的学习数据 scope · 课程 prompt",
    writes: "无",
    canDisable: false,
  },
  run: (ctx, onDelta) => {
    const l = ctx as LearningContext;
    return runLearningAgent(
      ctx.provider,
      {
        ...ctx.langs,
        experiencePreferences: l.experiencePreferences,
        agentName: l.agentName,
        agentPrompt: l.agentPrompt,
        dataContext: l.dataContext,
        summary: ctx.summary,
        history: ctx.history,
        userInput: ctx.userInput,
        kickoff: l.kickoff,
      },
      onDelta,
    );
  },
};

// 导师 observer:与主回复并行做结构化批改,turn 落库后走代码记账。
// LLM 只观察(给离散信号),计数由 recordAnalysis 算 —— 不在此处改任何 mastery 数字。
const tutorObserver: Observer = {
  id: "builtin:tutor",
  kind: "observer",
  card: {
    title: "批改导师",
    description: "并行批改每句:纠错、更自然说法、表达缺口,信号交给代码记账。",
    timing: "每轮 · 热路径 · 与回复并行",
    reads: "SQLite 薄弱表 · 当前输入",
    writes: "error/correct/introduced/gap 信号 → 代码记账(LLM 不碰计数)",
    canDisable: true,
  },
  run: async (ctx: PracticeContext) => {
    const { analysis, proseFeedback, diagnostic, error } = await analyze(
      ctx.provider,
      {
        ...ctx.langs,
        experiencePreferences: ctx.tutorPreferences,
        ignoreCapitalizationIssues: ctx.tutorFlags.ignoreCapitalizationIssues,
        ignorePunctuationIssues: ctx.tutorFlags.ignorePunctuationIssues,
        weakList: ctx.weakList,
        history: ctx.tutorHistory,
        userInput: ctx.userInput,
      },
    );

    // 等本轮 turn 行落库再写回;落库失败(reply 出错)则放弃记账,与迁移前一致。
    let turnId: string;
    try {
      turnId = await ctx.turnPersisted;
    } catch {
      return;
    }

    if (analysis) {
      ctx.callbacks.onAnalysis(analysis);
      try {
        await recordAnalysis(analysis, turnId);
        await updateTurnAnalysis(turnId, analysis);
        void maybeRunMaintainer();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logError("turn", "批改记账失败", e);
        ctx.callbacks.onAnalysis(analysis, {
          error: `批改已显示但保存失败: ${msg}`,
        });
      }
    } else if (proseFeedback) {
      try {
        await updateTurnAnalysis(turnId, null, proseFeedback, diagnostic);
      } catch (e) {
        logError("turn", "纯文本批改保存失败", e);
      }
      ctx.callbacks.onAnalysis(null, {
        proseFeedback,
        error: error ?? diagnostic,
      });
    } else if (error) {
      ctx.callbacks.onAnalysis(null, { error });
    }
  },
};

registerReplyProducer(conversationReply);
registerReplyProducer(learningReply);
registerObserver(tutorObserver);

const transformers: TransformerInfo[] = [
  {
    id: "builtin:transformer:explain",
    card: {
      title: "回复讲解",
      description: "按需用母语解释对话回复里可能卡住的结构、习语和地道用法。",
      timing: "用户点「讲解」",
      reads: "当前回复 · MD 档案切片 · 阅读偏好",
      writes: "无(只产出讲解文本)",
      canDisable: false,
    },
  },
  {
    id: "builtin:transformer:bilingual",
    card: {
      title: "双语阅读",
      description: "把一条回复重排成目标语言/母语逐句对照,方便读懂长回复。",
      timing: "用户点「双语」",
      reads: "当前回复 · 阅读偏好",
      writes: "无(只产出双语 Markdown)",
      canDisable: false,
    },
  },
  {
    id: "builtin:transformer:translate",
    card: {
      title: "划词解析",
      description: "结合上下文解释用户选中的词、短语或句子。",
      timing: "用户划选文本",
      reads: "选中文本 · 所在上下文 · 阅读偏好",
      writes: "无(只产出解析文本)",
      canDisable: false,
    },
  },
  {
    id: "builtin:transformer:reply_suggestion",
    card: {
      title: "推荐回复",
      description: "按需基于某条消息和上下文生成学习者可以发送的地道回复。",
      timing: "用户点「推荐回复」",
      reads: "当前消息 · 会话上下文 · MD 档案切片 · 表达偏好",
      writes: "无(只产出建议文本)",
      canDisable: false,
    },
  },
];

for (const transformer of transformers) registerTransformer(transformer);

// 对话衍生 Agent:点击后先创建 pending 新会话,新页面再运行 deriveContext 生成上下文并开场。
// 原会话始终不动(非破坏式),区别于「从此处开始」(截断)。
interface DerivationSpec {
  id: string;
  scope: ActionAgent["scope"];
  label: string;
  description: string;
  kind: BranchKind;
  objective: string;
  modifiers?: AgentModifiers;
}

function makeDerivationAction(spec: DerivationSpec): ActionAgent {
  return {
    id: spec.id,
    kind: "action",
    scope: spec.scope,
    label: spec.label,
    description: spec.description,
    branchKind: spec.kind,
    baseModifiers: spec.modifiers,
    card: {
      title: spec.label,
      description: spec.description,
      timing: "用户点击",
      reads: spec.scope === "turn" ? "当前会话 + 选中的这一轮" : "当前会话",
      writes: "衍生一个新对话上下文并新建会话(不改计数 / 密钥 / 设置)",
      canDisable: true,
    },
    // label/objective 在点击时实时读改写,用户在能力库改过 prompt 就立即生效。
    deriveContext: (ctx) => {
      const ov = getBuiltinActionOverride(spec.id);
      return deriveConversationContext(ctx, {
        label: ov?.label ?? spec.label,
        objective: ov?.objective ?? spec.objective,
      });
    },
  };
}

const derivationSpecs: DerivationSpec[] = [
  {
    id: "builtin:action:branch_from",
    scope: "turn",
    label: "从此处分支",
    description: "基于这条之前的上下文,另开一个新对话继续探索。",
    kind: "branch_from",
    objective:
      "Create a fresh continuation based on the selected source turn. Preserve the useful setup before that point, but start the new conversation cleanly without copying visible history.",
  },
  {
    id: "builtin:action:restart",
    scope: "session",
    label: "重新开始",
    description: "保留核心设定,生成一个空白的新对话重练。",
    kind: "restart",
    objective:
      "Restart the same useful scenario/persona from a clean beginning. Keep the learning purpose, but do not continue as if previous turns already happened.",
  },
  {
    id: "builtin:action:harder",
    scope: "session",
    label: "提高难度",
    description: "生成同一练习的高难度新对话。",
    kind: "harder",
    modifiers: { difficultyDelta: 1 },
    objective:
      "Create a harder version of the current practice. Keep the scenario and continuity that matter, but make the target-language demands richer, more idiomatic, and more challenging.",
  },
  {
    id: "builtin:action:easier",
    scope: "session",
    label: "降低难度",
    description: "生成同一练习的简单版新对话。",
    kind: "easier",
    modifiers: { difficultyDelta: -1 },
    objective:
      "Create an easier version of the current practice. Keep the useful scenario, but lower the difficulty: shorter sentences, common words, clearer prompts, and one idea at a time.",
  },
  {
    id: "builtin:action:swap_roles",
    scope: "session",
    label: "调换角色",
    description: "生成一个角色互换的新对话。",
    kind: "swap_roles",
    modifiers: { swapRoles: true },
    objective:
      "Create a role-swapped version of the current conversation. The learner should lead more of the exchange; the AI should take the counterpart role and respond naturally.",
  },
  {
    id: "builtin:action:next_day",
    scope: "session",
    label: "第二天继续",
    description: "生成一个承接当前剧情的第二天新对话。",
    kind: "next_day",
    modifiers: { nextDay: true },
    objective:
      "Create a new-day continuation. Use relevant continuity from the source conversation, but start on the next day with a natural reconnection and a fresh opening.",
  },
  {
    id: "builtin:action:change_scene",
    scope: "session",
    label: "换个场景",
    description: "保留练习目标,换一个更合适的新场景。",
    kind: "change_scene",
    objective:
      "Create a new scenario that practices the same useful language goals from the current conversation, but changes the setting so the learner can transfer the skill.",
  },
];

const LESSON_FROM_CONVERSATION_ID = "builtin:action:lesson_from_conversation";
const LESSON_FROM_CONVERSATION_DEFAULTS = {
  label: "变成专项课",
  description: "把当前聊天里的问题和目标整理成一个可复用专项课。",
  objective:
    "Create a focused lesson agent from this conversation. Identify the most useful practice theme, recurring mistakes, and next drill. Keep it practical and interactive.",
};

const lessonFromConversation: ActionAgent = {
  id: LESSON_FROM_CONVERSATION_ID,
  kind: "action",
  scope: "session",
  label: LESSON_FROM_CONVERSATION_DEFAULTS.label,
  description: "基于当前会话生成一个专项课,并新开课堂继续练。",
  card: {
    title: LESSON_FROM_CONVERSATION_DEFAULTS.label,
    description: LESSON_FROM_CONVERSATION_DEFAULTS.description,
    timing: "用户点击",
    reads: "当前会话历史 · 语言配置",
    writes: "创建一个专项课 Agent + 一个专项课会话",
    canDisable: true,
  },
  run: async (ctx) => {
    const provider = await getProvider();
    if (!provider) throw new Error("未配置 API key,请到设置页填写");
    const config = loadConfig();
    const turns = await getTurnsAfterId(ctx.conversationId, null);
    const history = formatTurns(turns);
    const instruction =
      getBuiltinActionOverride(LESSON_FROM_CONVERSATION_ID)?.objective ??
      LESSON_FROM_CONVERSATION_DEFAULTS.objective;
    const draft = await generateLearningAgentDraft(
      provider,
      `${instruction}\n\n=== CONVERSATION ===\n${history || "(empty)"}`,
      {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        level: config.level,
      },
    );
    const agentId = await createLearningAgent(draft);
    const conversationId = await createConversation(draft.name, undefined, {
      kind: "learning_agent",
      learningAgentId: agentId,
    });
    return { navigateTo: conversationId };
  },
};

const branchActions: ActionAgent[] = [
  ...derivationSpecs.map(makeDerivationAction),
  lessonFromConversation,
];

for (const action of branchActions) registerAction(action);

// 能力库可编辑的内置对话衍生动作:默认 label/description/objective,供 UI 预填与「恢复默认」。
// objective 即喂给衍生 Agent 的 prompt(专项课则是生成课程草案的指令)。
export interface BuiltinActionDefault {
  label: string;
  description: string;
  objective: string;
}

export const BUILTIN_ACTION_DEFAULTS: Record<string, BuiltinActionDefault> = {
  ...Object.fromEntries(
    derivationSpecs.map((spec) => [
      spec.id,
      {
        label: spec.label,
        description: spec.description,
        objective: spec.objective,
      },
    ]),
  ),
  [LESSON_FROM_CONVERSATION_ID]: LESSON_FROM_CONVERSATION_DEFAULTS,
};
