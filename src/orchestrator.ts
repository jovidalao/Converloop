import { getProvider, loadConfig } from "./config";
import { converse } from "./agents/conversation";
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
  onAnalysis: (analysis: TutorAnalysis | null, error?: string) => void;
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

  // 共享上下文(两个 agent 都读),先查好再喂。
  const history = await formatRecentHistory();
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
  const turnId = await persistTurn(userInput, reply, null);
  cb.onReplyComplete?.(reply);

  // 批改、记账、补全 analysis_json 在后台跑,不阻塞下一轮输入。
  void analysisPromise
    .then(async ({ analysis, error }) => {
      if (analysis) {
        cb.onAnalysis(analysis);
        try {
          await recordAnalysis(analysis);
          await updateTurnAnalysis(turnId, analysis);
          void maybeRunMaintainer();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("批改记账失败:", e);
          cb.onAnalysis(analysis, `批改已显示但保存失败: ${msg}`);
        }
      } else {
        cb.onAnalysis(
          null,
          error ?? "批改未能完成,请查看控制台日志。",
        );
      }
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("批改失败:", e);
      cb.onAnalysis(null, `批改失败: ${msg}`);
    });

  return { reply, analysis: null };
}
