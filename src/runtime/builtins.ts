// 内置 Agent(Phase 1):把现有 converse / runLearningAgent / tutor 包成 Runtime Agent
// 并在本模块求值时自注册。行为与迁移前的 orchestrator 一致,只是「谁调用它」换成了 Runtime。
// 从 ./index 的副作用 import 触发注册。

import { converse } from "../agents/conversation";
import { runLearningAgent } from "../agents/learning";
import { analyze } from "../agents/tutor";
import {
  type AgentModifiers,
  BRANCH_KIND_LABEL,
  type BranchKind,
  createBranch,
  formatModifierInstructions,
  getConversation,
} from "../db/conversations";
import { recordAnalysis } from "../db/mastery";
import { updateTurnAnalysis } from "../db/turns";
import { logError } from "../lib/log";
import { maybeRunMaintainer } from "../profile/maintainer-runner";
import {
  registerAction,
  registerObserver,
  registerReplyProducer,
} from "./registry";
import type {
  ActionAgent,
  LearningContext,
  Observer,
  PracticeContext,
  ReplyProducer,
} from "./types";

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

// 会话动作 Agent:多数只是「代码建分支 + 注入修饰符」。run 建好分支返回新会话 id,UI 跳过去。
// 原会话始终不动(非破坏式),区别于「从此处开始」(截断)。
function makeBranchAction(spec: {
  id: string;
  scope: ActionAgent["scope"];
  label: string;
  description: string;
  kind: BranchKind;
  modifiers?: AgentModifiers;
  copyTurns: "all" | "none" | "upToSource";
}): ActionAgent {
  return {
    id: spec.id,
    kind: "action",
    scope: spec.scope,
    label: spec.label,
    description: spec.description,
    card: {
      title: spec.label,
      description: spec.description,
      timing: "用户点击",
      reads: spec.scope === "turn" ? "当前会话 + 选中的这一轮" : "当前会话",
      writes: "新建一个分支会话(不改计数 / 密钥 / 设置)",
      canDisable: true,
    },
    run: async (ctx) => {
      const parent = await getConversation(ctx.conversationId);
      const baseTitle = parent?.title?.trim() || "对话";
      const copyTurns =
        spec.copyTurns === "upToSource"
          ? ctx.sourceTurnId
            ? { upToTurnId: ctx.sourceTurnId }
            : "none"
          : spec.copyTurns;
      const newId = await createBranch({
        parentId: ctx.conversationId,
        branchKind: spec.kind,
        title: `${baseTitle} · ${BRANCH_KIND_LABEL[spec.kind]}`,
        modifiers: spec.modifiers,
        copyTurns,
        sourceTurnId: ctx.sourceTurnId ?? null,
      });
      return { navigateTo: newId };
    },
  };
}

const branchActions: ActionAgent[] = [
  makeBranchAction({
    id: "builtin:action:branch_from",
    scope: "turn",
    label: "从此处分支",
    description: "复制到这条为止,另开一个分支继续探索(原对话保留)。",
    kind: "branch_from",
    copyTurns: "upToSource",
  }),
  makeBranchAction({
    id: "builtin:action:restart",
    scope: "session",
    label: "重新开始",
    description: "用同样的设定另开一个空白分支重练。",
    kind: "restart",
    copyTurns: "none",
  }),
  makeBranchAction({
    id: "builtin:action:harder",
    scope: "session",
    label: "提高难度",
    description: "带着当前进展另开分支,把难度调高一档。",
    kind: "harder",
    modifiers: { difficultyDelta: 1 },
    copyTurns: "all",
  }),
  makeBranchAction({
    id: "builtin:action:easier",
    scope: "session",
    label: "降低难度",
    description: "带着当前进展另开分支,把难度调低一档。",
    kind: "easier",
    modifiers: { difficultyDelta: -1 },
    copyTurns: "all",
  }),
  makeBranchAction({
    id: "builtin:action:swap_roles",
    scope: "session",
    label: "调换角色",
    description: "另开分支,让你来主导、AI 跟随回应。",
    kind: "swap_roles",
    modifiers: { swapRoles: true },
    copyTurns: "all",
  }),
  makeBranchAction({
    id: "builtin:action:next_day",
    scope: "session",
    label: "第二天继续",
    description: "另开分支,作为「第二天」自然地接着聊。",
    kind: "next_day",
    modifiers: { nextDay: true },
    copyTurns: "all",
  }),
];

for (const action of branchActions) registerAction(action);
