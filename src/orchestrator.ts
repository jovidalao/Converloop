import { bilingual } from "./agents/bilingual";
import { converse } from "./agents/conversation";
import { explain } from "./agents/explain";
import { runLearningAgent } from "./agents/learning";
import { generateLearningAgentDraft } from "./agents/learning-agent-builder";
import type { TutorAnalysis } from "./agents/schema";
import { translate } from "./agents/translate";
import { analyze } from "./agents/tutor";
import { getProvider, loadConfig } from "./config";
import { applyDataEditInstruction, type DataEditResult } from "./data-edit";
import { getConversation, getSummary } from "./db/conversations";
import { createLearningAgent, getLearningAgent } from "./db/learning-agents";
import { getReviewDueList, getWeakList, recordAnalysis } from "./db/mastery";
import { getProficiencySnapshot } from "./db/proficiency";
import {
  formatTurns,
  getTurnsAfterId,
  persistTurn,
  updateTurnAnalysis,
} from "./db/turns";
import { buildLearningDataContext } from "./learning-data";
import { logError } from "./lib/log";
import { estimateTokens } from "./lib/tokens";
import { maybeRunMaintainer } from "./profile/maintainer-runner";
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

export async function editLearningDataWithInstruction(
  instruction: string,
): Promise<DataEditResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  return applyDataEditInstruction(provider, instruction, loadConfig());
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

  // 并行发出:对话流式,导师结构化。互不阻塞。
  const replyPromise = converse(
    provider,
    {
      ...langs,
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
    .then(async ({ analysis, proseFeedback, error }) => {
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
          await updateTurnAnalysis(turnId, null, proseFeedback);
        } catch (e) {
          logError("turn", "纯文本批改保存失败", e);
        }
        cb.onAnalysis(null, { proseFeedback });
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
  const [summaryData, dataContext] = await Promise.all([
    getSummary(conversationId),
    buildLearningDataContext(agent, config),
  ]);
  const history = formatTurns(
    await getTurnsAfterId(conversationId, summaryData.throughId),
  );

  const reply = await runLearningAgent(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
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

// 按需讲解某条对话回复:读 MD 档案(和对话 agent 同源),流式输出母语讲解。
// 不在热路径,不持久化——讲解便宜,需要时重新生成即可。
export async function explainReply(
  reply: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const profileSlice = profileSliceForConversation(await readProfile(config));

  return explain(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      level: config.level,
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
  return bilingual(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
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
  return translate(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      selection,
      context,
    },
    onDelta,
  );
}
