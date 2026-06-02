import { bilingual } from "./agents/bilingual";
import { converse } from "./agents/conversation";
import { explain } from "./agents/explain";
import { runLearningAgent } from "./agents/learning";
import { generateLearningAgentDraft } from "./agents/learning-agent-builder";
import { classifyProfilePreferenceInstruction } from "./agents/profile-preferences";
import type { TutorAnalysis } from "./agents/schema";
import { planLearningProject } from "./agents/task-agent";
import { translate } from "./agents/translate";
import { analyze } from "./agents/tutor";
import { getProvider, loadConfig } from "./config";
import { applyDataEditInstruction, type DataEditResult } from "./data-edit";
import { runTrackedAgentJob } from "./db/agent-jobs";
import { getConversation, getSummary } from "./db/conversations";
import { createLearningAgent, getLearningAgent } from "./db/learning-agents";
import { createLearningProject } from "./db/learning-projects";
import { getReviewDueList, getWeakList, recordAnalysis } from "./db/mastery";
import { getProficiencySnapshot } from "./db/proficiency";
import {
  formatTurns,
  getTurnsAfterId,
  persistTurn,
  updateTurnAnalysis,
  updateTurnReply,
} from "./db/turns";
import { buildLearningDataContext } from "./learning-data";
import { logError } from "./lib/log";
import { estimateTokens } from "./lib/tokens";
import { maybeRunMaintainer } from "./profile/maintainer-runner";
import {
  appendClassifiedPreferences,
  correctionPreferenceFlags,
  formatExperiencePreferences,
  preferencesFromProfile,
} from "./profile/preferences";
import { profileSliceForConversation, readProfile } from "./profile/profile";
import { maybeCompressConversation } from "./profile/summary-runner";

export interface TurnCallbacks {
  onReplyDelta: (delta: string) => void;
  /** 对话流式结束、可继续输入时触发;批改仍在后台进行。 */
  onReplyComplete?: (reply: string) => void;
  onAnalysis: (
    analysis: TutorAnalysis | null,
    opts?: { error?: string; proseFeedback?: string },
  ) => void;
}

export interface TurnResult {
  reply: string;
  analysis: TutorAnalysis | null;
}

// 导师只需消歧最新一句的语境,给直近这么多轮即可;水位后的全部原文留给对话 agent。
const TUTOR_HISTORY_TURNS = 8;

export class MissingApiKeyError extends Error {
  constructor() {
    super("未配置 API key,请到设置页填写");
    this.name = "MissingApiKeyError";
  }
}

export async function createCustomLearningAgentFromDescription(
  description: string,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const draft = await generateLearningAgentDraft(provider, description, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  });
  return createLearningAgent(draft);
}

export async function createLearningProjectFromGoal(
  description: string,
): Promise<{
  projectId: string;
  createdLearningAgentIds: string[];
  jobId: string;
}> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const ctx = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };
  const { jobId, result } = await runTrackedAgentJob(
    {
      kind: "learning_project_plan",
      source: "task_agent",
      input: { description, ...ctx },
    },
    async () => {
      const plan = await planLearningProject(provider, description, ctx);
      const projectId = await createLearningProject({
        title: plan.title,
        goal: plan.goal,
        planMd: plan.planMarkdown,
        notesMd: plan.notesMarkdown,
        sourcePrompt: description,
        taskPlan: plan.raw,
      });
      const createdLearningAgentIds: string[] = [];
      for (const lesson of plan.suggestedLessons) {
        createdLearningAgentIds.push(await createLearningAgent(lesson));
      }
      return {
        projectId,
        createdLearningAgentIds,
        title: plan.title,
        goal: plan.goal,
        nextActions: plan.nextActions,
      };
    },
  );

  return {
    projectId: result.projectId,
    createdLearningAgentIds: result.createdLearningAgentIds,
    jobId,
  };
}

export async function editLearningDataWithInstruction(
  instruction: string,
): Promise<DataEditResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  return applyDataEditInstruction(provider, instruction, loadConfig());
}

export async function applyProfilePreferenceInstruction(
  instruction: string,
  currentProfileMd: string,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  const items = await classifyProfilePreferenceInstruction(
    provider,
    instruction,
    preferencesFromProfile(currentProfileMd),
  );
  return appendClassifiedPreferences(currentProfileMd, items);
}

// 端到端一轮:对话 ∥ 导师并行 → 对话流式秒回、批改稍后到 → 记账 + 持久化。
// 导师崩了不影响对话(降级:analysis=null,本轮不更新 mastery)。
export async function runTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
): Promise<TurnResult> {
  const conversation = await getConversation(conversationId);
  if (conversation?.kind === "learning_agent") {
    return runLearningTurn(userInput, conversationId, cb, false);
  }

  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };

  // 共享上下文(两个 agent 都读),先查好再喂。彼此独立,并行取以免叠加延迟、拖慢首 token。
  // 历史按当前会话隔离(话题不串);weakList / reviewItems / proficiency 走全局掌握表。
  // 自动压缩:对话上下文 = 滚动摘要(较早内容)+ 水位之后的全部原文。摘要为 NULL 时退化为纯原文。
  const [summaryData, weakList, profileMd, reviewItems, proficiency] =
    await Promise.all([
      getSummary(conversationId),
      getWeakList(),
      readProfile(config),
      getReviewDueList(),
      getProficiencySnapshot(),
    ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  const history = formatTurns(verbatimTurns);
  // 导师拿直近几轮即可,别把水位后的全部原文喂进结构化分析(省 token、缩短输入)。
  const tutorHistory = formatTurns(verbatimTurns.slice(-TUTOR_HISTORY_TURNS));
  const profileSlice = profileSliceForConversation(profileMd);
  const conversationPreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );
  const tutorPreferences = formatExperiencePreferences(profileMd, "tutor");
  const tutorFlags = correctionPreferenceFlags(profileMd);

  // 并行发出:对话流式,导师结构化。互不阻塞。
  const replyPromise = converse(
    provider,
    {
      ...langs,
      experiencePreferences: conversationPreferences,
      profileSlice,
      reviewItems,
      calibrationHint: proficiency.calibrationHint,
      summary: summaryData.summary ?? "",
      history,
      userInput,
    },
    cb.onReplyDelta,
  );
  const analysisPromise = analyze(provider, {
    ...langs,
    experiencePreferences: tutorPreferences,
    ignoreCapitalizationIssues: tutorFlags.ignoreCapitalizationIssues,
    ignorePunctuationIssues: tutorFlags.ignorePunctuationIssues,
    weakList,
    history: tutorHistory,
    userInput,
  });

  const reply = await replyPromise;
  const turnId = await persistTurn(conversationId, userInput, reply, null);
  cb.onReplyComplete?.(reply);

  // 自动压缩:逼近上下文上限时,后台把最老的原文折叠进滚动摘要。不阻塞下一轮输入。
  // 非历史动态块 = profile + 复习列表,叠加到固定 reserve 上,让水位贴合本轮实际负载。
  const nonHistoryTokens =
    estimateTokens(profileSlice) +
    estimateTokens(
      reviewItems
        .map((r) => `${r.label} ${r.example ?? ""} ${r.notes ?? ""}`)
        .join("\n"),
    );
  void maybeCompressConversation(conversationId, nonHistoryTokens);

  // 批改、记账、补全 analysis_json 在后台跑,不阻塞下一轮输入。
  void analysisPromise
    .then(async ({ analysis, proseFeedback, diagnostic, error }) => {
      if (analysis) {
        cb.onAnalysis(analysis);
        try {
          await recordAnalysis(analysis, turnId);
          await updateTurnAnalysis(turnId, analysis);
          void maybeRunMaintainer();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logError("turn", "批改记账失败", e);
          cb.onAnalysis(analysis, { error: `批改已显示但保存失败: ${msg}` });
        }
      } else if (proseFeedback) {
        try {
          await updateTurnAnalysis(turnId, null, proseFeedback, diagnostic);
        } catch (e) {
          logError("turn", "纯文本批改保存失败", e);
        }
        cb.onAnalysis(null, { proseFeedback, error: error ?? diagnostic });
      } else if (error) {
        cb.onAnalysis(null, { error });
      }
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      logError("turn", "批改失败", e);
      cb.onAnalysis(null, { error: `批改失败: ${msg}` });
    });

  return { reply, analysis: null };
}

export async function startLearningSession(
  conversationId: string,
  cb: TurnCallbacks,
): Promise<TurnResult> {
  return runLearningTurn("", conversationId, cb, true);
}

async function runLearningTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  kickoff: boolean,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const conversation = await getConversation(conversationId);
  const agentId = conversation?.learningAgentId;
  if (!agentId) throw new Error("这个专项课没有绑定学习 Agent");

  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error("找不到这个学习 Agent");

  const config = loadConfig();
  // 自动压缩:课程上下文 = 滚动摘要(较早内容)+ 水位之后的全部原文。摘要为 NULL 时退化为纯原文。
  const [summaryData, dataContext, profileMd] = await Promise.all([
    getSummary(conversationId),
    buildLearningDataContext(agent, config),
    readProfile(config),
  ]);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "learning",
  );
  const history = formatTurns(
    await getTurnsAfterId(conversationId, summaryData.throughId),
  );

  const reply = await runLearningAgent(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
      experiencePreferences,
      agentName: agent.name,
      agentPrompt: agent.prompt,
      dataContext,
      summary: summaryData.summary ?? "",
      history,
      userInput,
      kickoff,
    },
    cb.onReplyDelta,
  );

  await persistTurn(conversationId, userInput, reply, null);
  cb.onReplyComplete?.(reply);
  // 自动压缩:逼近上下文上限时,后台把最老的原文折叠进滚动摘要。不阻塞下一轮输入。
  // 专项课的非历史动态块 = dataContext + agent prompt,通常比普通对话大得多,据此提高 reserve。
  const nonHistoryTokens =
    estimateTokens(dataContext) + estimateTokens(agent.prompt);
  void maybeCompressConversation(conversationId, nonHistoryTokens);
  cb.onAnalysis(null);
  return { reply, analysis: null };
}

// 重新生成最新一条对话回复:用同样的用户输入和「该轮之前」的历史重跑对话 agent,
// 流式产出新回复并覆盖持久化的 reply。批改不变(只换 AI 那句,不动用户那句的分析)。
// 仅用于普通对话(practice);专项课不暴露此操作。
export async function regenerateReply(
  conversationId: string,
  turnId: string,
  cb: {
    onReplyDelta: (delta: string) => void;
    onReplyComplete?: (reply: string) => void;
  },
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  // 上下文构成与 runTurn 的对话侧一致:摘要 + 水位后原文,叠加 profile / 复习 / 校准。
  const [summaryData, profileMd, reviewItems, proficiency] = await Promise.all([
    getSummary(conversationId),
    readProfile(config),
    getReviewDueList(),
    getProficiencySnapshot(),
  ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  const idx = verbatimTurns.findIndex((t) => t.id === turnId);
  if (idx < 0) throw new Error("找不到要重新生成的回复");
  const target = verbatimTurns[idx];
  // 历史只取「该轮之前」的原文:把被重生成的这轮及其之后排除,避免把旧回复喂回去。
  const history = formatTurns(verbatimTurns.slice(0, idx));
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );

  const reply = await converse(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
      experiencePreferences,
      profileSlice: profileSliceForConversation(profileMd),
      reviewItems,
      calibrationHint: proficiency.calibrationHint,
      summary: summaryData.summary ?? "",
      history,
      userInput: target.userInput,
    },
    cb.onReplyDelta,
  );

  await updateTurnReply(turnId, reply);
  cb.onReplyComplete?.(reply);
  return reply;
}

// 按需讲解某条对话回复:读 MD 档案(和对话 agent 同源),流式输出母语讲解。
// 不在热路径,不持久化——讲解便宜,需要时重新生成即可。
export async function explainReply(
  reply: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const profileMd = await readProfile(config);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "reading",
  );
  const profileSlice = profileSliceForConversation(profileMd);

  return explain(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
      experiencePreferences,
      profileSlice,
      reply,
    },
    onDelta,
  );
}

// 双语阅读:把一条对话回复做成目标语言/母语逐句对照(双语 Markdown)。
// 不读档案、不持久化——便宜,需要时重新生成即可。
export async function bilingualReply(reply: string): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const experiencePreferences = formatExperiencePreferences(
    await readProfile(config),
    "reading",
  );
  return bilingual(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    experiencePreferences,
    reply,
  });
}

// 划词翻译/解析:对话里选中一段文字,结合所在语境流式输出母语解析。
// 不读档案、不持久化——便宜,需要时重新生成即可。
export async function translateSelection(
  selection: string,
  context: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const experiencePreferences = formatExperiencePreferences(
    await readProfile(config),
    "reading",
  );
  return translate(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      experiencePreferences,
      selection,
      context,
    },
    onDelta,
  );
}
