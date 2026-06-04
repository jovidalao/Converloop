import { bilingual } from "./agents/bilingual";
import { converse } from "./agents/conversation";
import { explain } from "./agents/explain";
import { generateLearningAgentDraft } from "./agents/learning-agent-builder";
import { classifyProfilePreferenceInstruction } from "./agents/profile-preferences";
import {
  type ReplySuggestionResult,
  type ReplySuggestionSource,
  suggestReplyText,
} from "./agents/reply-suggestion";
import type { TutorAnalysis } from "./agents/schema";
import { planLearningProject } from "./agents/task-agent";
import { translate } from "./agents/translate";
import { getProvider, loadConfig } from "./config";
import { applyDataEditInstruction, type DataEditResult } from "./data-edit";
import { runTrackedAgentJob } from "./db/agent-jobs";
import {
  completeDerivedConversation,
  failDerivedConversation,
  formatModifierInstructions,
  getConversation,
  getSummary,
  parseAgentModifiers,
} from "./db/conversations";
import { createLearningAgent, getLearningAgent } from "./db/learning-agents";
import { createLearningProject } from "./db/learning-projects";
import { getReviewDueList, getWeakList } from "./db/mastery";
import { getProficiencySnapshot } from "./db/proficiency";
import {
  formatTurns,
  getTurnsAfterId,
  persistTurn,
  updateTurnReply,
} from "./db/turns";
import { buildLearningDataContext } from "./learning-data";
import { estimateTokens } from "./lib/tokens";
import {
  appendClassifiedPreferences,
  correctionPreferenceFlags,
  formatExperiencePreferences,
  preferencesFromProfile,
} from "./profile/preferences";
import { profileSliceForConversation, readProfile } from "./profile/profile";
import { maybeCompressConversation } from "./profile/summary-runner";
import {
  type ConversationCallbacks,
  derivePendingAction,
  dispatchObservers,
  dispatchReply,
  HOOKS,
  type LearningContext,
  type PracticeContext,
  runTransformer,
} from "./runtime";

// 回调形状统一定义在 runtime(ConversationCallbacks),这里别名导出保持既有引用。
export type TurnCallbacks = ConversationCallbacks;

export interface TurnResult {
  reply: string;
  analysis: TutorAnalysis | null;
}

// 导师只需消歧最新一句的语境,给直近这么多轮即可;水位后的全部原文留给对话 agent。
const TUTOR_HISTORY_TURNS = 8;
const SUGGESTION_CONTEXT_CHARS = 12000;

export class MissingApiKeyError extends Error {
  constructor() {
    super("未配置 API key,请到设置页填写");
    this.name = "MissingApiKeyError";
  }
}

function tailTurnsByChars<T extends { userInput: string; reply: string }>(
  turns: T[],
  charBudget: number,
): T[] {
  let used = 0;
  let start = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const next = turns[i];
    const cost = next.userInput.length + next.reply.length + 32;
    if (used + cost > charBudget && start < turns.length) break;
    used += cost;
    start = i;
  }
  return turns.slice(start);
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
  turnId?: string,
): Promise<TurnResult> {
  const conversation = await getConversation(conversationId);
  if (conversation?.kind === "learning_agent") {
    return runLearningTurn(userInput, conversationId, cb, false, turnId);
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
  // 会话级调节(分支带来的难度/角色/第二天);普通会话为空对象,回复 Agent 自然忽略。
  const agentModifiers = parseAgentModifiers(
    conversation?.agentModifiersJson ?? null,
  );

  // 复用前端乐观渲染时生成的 turnId(若提供):让 UI 这条气泡与持久化的 DB 行同 id,
  // 这样「从此处开始」(按 id 截断)和「重新生成」(按 id 定位)在刷新前也能命中本轮。
  const id = turnId ?? crypto.randomUUID();
  // observer 与日志都挂这条 turn;observer 写回前等 turnPersisted,避免往未落库的行写。
  let resolvePersisted!: (value: string) => void;
  let rejectPersisted!: (reason: unknown) => void;
  const turnPersisted = new Promise<string>((resolve, reject) => {
    resolvePersisted = resolve;
    rejectPersisted = reject;
  });
  void turnPersisted.catch(() => {}); // observer 也会 catch;这里兜底防未处理 rejection

  const ctx: PracticeContext = {
    kind: "practice",
    provider,
    conversationId,
    turnId: id,
    userInput,
    langs,
    profileSlice,
    conversationPreferences,
    tutorPreferences,
    tutorFlags,
    summary: summaryData.summary ?? "",
    history,
    tutorHistory,
    weakList,
    reviewItems,
    proficiency,
    agentModifiers,
    callbacks: cb,
    turnPersisted,
  };

  // 主回复 ∥ observer 并行触发。observer fire-and-forget,自行等 turnPersisted 后走代码记账。
  const replyPromise = dispatchReply(ctx, cb.onReplyDelta);
  dispatchObservers(ctx);

  let reply: string;
  try {
    reply = await replyPromise;
  } catch (e) {
    rejectPersisted(e); // 回复失败 → turn 不落库,observer 放弃记账(与迁移前一致)
    throw e;
  }

  await persistTurn(conversationId, userInput, reply, null, id);
  resolvePersisted(id);
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

  return { reply, analysis: null };
}

export async function startLearningSession(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  return runLearningTurn("", conversationId, cb, true, turnId);
}

export async function startDerivedConversation(
  conversationId: string,
  cb: TurnCallbacks,
  turnId?: string,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  let openingInstruction = "";
  try {
    const derivedContext = await derivePendingAction(conversationId);
    await completeDerivedConversation(conversationId, derivedContext);
    openingInstruction = `Start this newly derived conversation now. Follow the derived conversation context exactly, especially this opening instruction: ${derivedContext.openingInstruction}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failDerivedConversation(conversationId, msg);
    throw e;
  }

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };

  const [summaryData, weakList, profileMd, reviewItems, proficiency, conv] =
    await Promise.all([
      getSummary(conversationId),
      getWeakList(),
      readProfile(config),
      getReviewDueList(),
      getProficiencySnapshot(),
      getConversation(conversationId),
    ]);
  const verbatimTurns = await getTurnsAfterId(
    conversationId,
    summaryData.throughId,
  );
  const history = formatTurns(verbatimTurns);
  const profileSlice = profileSliceForConversation(profileMd);
  const conversationPreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );
  const id = turnId ?? crypto.randomUUID();
  const turnPersisted = Promise.resolve(id);

  const ctx: PracticeContext = {
    kind: "practice",
    provider,
    conversationId,
    turnId: id,
    userInput: "",
    openingInstruction,
    langs,
    profileSlice,
    conversationPreferences,
    tutorPreferences: "",
    tutorFlags: {
      ignoreCapitalizationIssues: false,
      ignorePunctuationIssues: false,
    },
    summary: summaryData.summary ?? "",
    history,
    tutorHistory: "",
    weakList,
    reviewItems,
    proficiency,
    agentModifiers: parseAgentModifiers(conv?.agentModifiersJson ?? null),
    callbacks: cb,
    turnPersisted,
  };

  const reply = await dispatchReply(ctx, cb.onReplyDelta);
  await persistTurn(conversationId, "", reply, null, id);
  cb.onReplyComplete?.(reply);
  cb.onAnalysis(null);

  const nonHistoryTokens =
    estimateTokens(profileSlice) +
    estimateTokens(
      reviewItems
        .map((r) => `${r.label} ${r.example ?? ""} ${r.notes ?? ""}`)
        .join("\n"),
    );
  void maybeCompressConversation(conversationId, nonHistoryTokens);
  return { reply, analysis: null };
}

async function runLearningTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
  kickoff: boolean,
  turnId?: string,
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

  const id = turnId ?? crypto.randomUUID();
  // 专项课不跑 observer;turnPersisted 只为满足 ConversationContext 形状,落库后 resolve。
  let resolvePersisted!: (value: string) => void;
  const turnPersisted = new Promise<string>((resolve) => {
    resolvePersisted = resolve;
  });
  void turnPersisted.catch(() => {});

  const ctx: LearningContext = {
    kind: "learning_agent",
    provider,
    conversationId,
    turnId: id,
    userInput,
    langs: {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
    },
    experiencePreferences,
    agentName: agent.name,
    agentPrompt: agent.prompt,
    dataContext,
    summary: summaryData.summary ?? "",
    history,
    kickoff,
    callbacks: cb,
    turnPersisted,
  };

  const reply = await dispatchReply(ctx, cb.onReplyDelta);

  await persistTurn(conversationId, userInput, reply, null, id);
  resolvePersisted(id);
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
  // 上下文构成与 runTurn 的对话侧一致:摘要 + 水位后原文,叠加 profile / 复习 / 校准 / 会话调节。
  const [summaryData, profileMd, reviewItems, proficiency, conv] =
    await Promise.all([
      getSummary(conversationId),
      readProfile(config),
      getReviewDueList(),
      getProficiencySnapshot(),
      getConversation(conversationId),
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
      sessionAdjustments: formatModifierInstructions(
        parseAgentModifiers(conv?.agentModifiersJson ?? null),
      ),
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

  return runTransformer(
    "builtin:transformer:explain",
    HOOKS.turnExplain,
    () =>
      explain(
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
      ),
    (text) => ({ chars: text.length }),
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
  return runTransformer(
    "builtin:transformer:bilingual",
    HOOKS.turnBilingual,
    () =>
      bilingual(provider, {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        experiencePreferences,
        reply,
      }),
    (text) => ({ chars: text.length }),
  );
}

// 推荐回复:用户消息下=按已发送含义改写成地道目标语;AI 回复下=基于上下文生成下一句。
// 按需 transformer,不进热路径、不持久化、不更新学习计数。
export async function suggestReply(
  conversationId: string,
  turnId: string,
  source: ReplySuggestionSource,
  onDelta: (delta: string) => void,
): Promise<ReplySuggestionResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const [profileMd, turns] = await Promise.all([
    readProfile(config),
    getTurnsAfterId(conversationId, null),
  ]);
  const idx = turns.findIndex((t) => t.id === turnId);
  if (idx < 0) throw new Error("找不到要生成推荐回复的消息");

  const target = turns[idx];
  const contextTurns =
    source === "user_message" ? turns.slice(0, idx) : turns.slice(0, idx + 1);
  const history = formatTurns(
    tailTurnsByChars(contextTurns, SUGGESTION_CONTEXT_CHARS),
  );
  const profileSlice = profileSliceForConversation(profileMd);
  const experiencePreferences = formatExperiencePreferences(
    profileMd,
    "conversation",
  );

  return runTransformer(
    "builtin:transformer:reply_suggestion",
    HOOKS.turnReplySuggestion,
    () =>
      suggestReplyText(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          level: config.level,
          experiencePreferences,
          profileSlice,
          history,
          source,
          userMessage: source === "user_message" ? target.userInput : undefined,
          partnerReply: source === "partner_reply" ? target.reply : undefined,
        },
        onDelta,
      ),
    (result) => ({
      chars: result.text.length,
      finishReason: result.finishReason?.raw,
      source,
    }),
  );
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
  return runTransformer(
    "builtin:transformer:translate",
    HOOKS.turnTranslate,
    () =>
      translate(
        provider,
        {
          nativeLanguage: config.nativeLanguage,
          targetLanguage: config.targetLanguage,
          experiencePreferences,
          selection,
          context,
        },
        onDelta,
      ),
    (text) => ({ chars: text.length }),
  );
}
