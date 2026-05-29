import { getProvider, loadConfig } from "./config";
import { converse } from "./agents/conversation";
import { analyze } from "./agents/tutor";
import type { TutorAnalysis } from "./agents/schema";
import { getWeakList, recordAnalysis } from "./db/mastery";
import { formatRecentHistory, persistTurn } from "./db/turns";
import { readProfile, profileSliceForConversation } from "./profile/profile";
import { maybeRunMaintainer } from "./profile/maintainer-runner";

export interface TurnCallbacks {
  onReplyDelta: (delta: string) => void;
  onAnalysis: (analysis: TutorAnalysis | null) => void;
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
  }).then((a) => {
    cb.onAnalysis(a);
    return a;
  });

  const [reply, analysis] = await Promise.all([replyPromise, analysisPromise]);

  // 记账(代码侧)+ 持久化本轮。
  if (analysis) await recordAnalysis(analysis);
  await persistTurn(userInput, reply, analysis);

  // 每 N 轮在后台刷新 MD 档案,不阻塞本轮返回。
  void maybeRunMaintainer();

  return { reply, analysis };
}
