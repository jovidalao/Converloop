import { getProvider, loadConfig } from "./config";
import { converse } from "./agents/conversation";
import { explain } from "./agents/explain";
import { bilingual } from "./agents/bilingual";
import { analyze } from "./agents/tutor";
import type { TutorAnalysis } from "./agents/schema";
import { getWeakList, recordAnalysis } from "./db/mastery";
import {
  formatRecentHistory,
  persistTurn,
  updateTurnAnalysis,
} from "./db/turns";
import { readProfile, profileSliceForConversation } from "./profile/profile";
import { maybeRunMaintainer } from "./profile/maintainer-runner";

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

export class MissingApiKeyError extends Error {
  constructor() {
    super("未配置 API key,请到设置页填写");
    this.name = "MissingApiKeyError";
  }
}

// 端到端一轮:对话 ∥ 导师并行 → 对话流式秒回、批改稍后到 → 记账 + 持久化。
// 导师崩了不影响对话(降级:analysis=null,本轮不更新 mastery)。
export async function runTurn(
  userInput: string,
  conversationId: string,
  cb: TurnCallbacks,
): Promise<TurnResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const langs = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };

  // 共享上下文(两个 agent 都读),先查好再喂。按当前会话隔离,话题不串。
  const history = await formatRecentHistory(conversationId);
  const weakList = await getWeakList();
  const profileSlice = profileSliceForConversation(await readProfile(config));

  // 并行发出:对话流式,导师结构化。互不阻塞。
  const replyPromise = converse(
    provider,
    { ...langs, profileSlice, history, userInput },
    cb.onReplyDelta,
  );
  const analysisPromise = analyze(provider, {
    ...langs,
    weakList,
    history,
    userInput,
  });

  const reply = await replyPromise;
  const turnId = await persistTurn(conversationId, userInput, reply, null);
  cb.onReplyComplete?.(reply);

  // 批改、记账、补全 analysis_json 在后台跑,不阻塞下一轮输入。
  void analysisPromise
    .then(async ({ analysis, proseFeedback, error }) => {
      if (analysis) {
        cb.onAnalysis(analysis);
        try {
          await recordAnalysis(analysis);
          await updateTurnAnalysis(turnId, analysis);
          void maybeRunMaintainer();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("批改记账失败:", e);
          cb.onAnalysis(analysis, { error: `批改已显示但保存失败: ${msg}` });
        }
      } else if (proseFeedback) {
        try {
          await updateTurnAnalysis(turnId, null, proseFeedback);
        } catch (e) {
          console.error("纯文本批改保存失败:", e);
        }
        cb.onAnalysis(null, { proseFeedback });
      } else if (error) {
        cb.onAnalysis(null, { error });
      }
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("批改失败:", e);
      cb.onAnalysis(null, { error: `批改失败: ${msg}` });
    });

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

// 双语阅读:把一条对话回复做成目标语言/母语逐句对照。
// 不读档案、不持久化——便宜,需要时重新生成即可。
export async function bilingualReply(
  reply: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  return bilingual(
    provider,
    {
      nativeLanguage: config.nativeLanguage,
      targetLanguage: config.targetLanguage,
      reply,
    },
    onDelta,
  );
}
