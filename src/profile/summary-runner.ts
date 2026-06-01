import { summarizeConversation } from "../agents/summarize";
import { getContextLimit, getProvider, loadConfig } from "../config";
import { getSummary, setSummary } from "../db/conversations";
import type { Turn } from "../db/schema";
import { formatTurns, getTurnsAfterId } from "../db/turns";
import { logError } from "../lib/log";
import { estimateTokens } from "../lib/tokens";

// 自动压缩:阈值驱动的会话滚动摘要。每轮持久化后在后台跑,把「逼近上下文上限」的会话
// 里最老的原文轮次折叠进摘要,腾出窗口。绝不阻塞热路径、绝不抛(见 docs/conversation-agent.md#滚动摘要)。

// 高/低水位:估算「会话上下文(摘要 + 原文)」token 超过上限的 70% 才压缩,压到 ~50% 为止
// (低水位避免每轮都重压)。
const HIGH_WATER = 0.7;
const LOW_WATER = 0.5;

// 至少保留这么多轮原文,近处细节永不丢(即便预算极小)。
const MIN_VERBATIM_TURNS = 6;

// 摘要输出字符上限(粗略对应 token 预算)。
const SUMMARY_CHAR_BUDGET = 1500;

// 非历史部分(system 规则 + 档案 + 复习 + 校准)与模型输出的粗略 token 预留。
// 历史预算 = 上限 * 水位 − 这个预留。估算是粗的,靠 30% headroom 吸收偏差。
const NON_HISTORY_RESERVE = 2000;

// 新摘要尚未生成时的 token 预留(按字符预算保守折算,用于算「保留多少原文」时给摘要留位)。
const SUMMARY_RESERVE = Math.ceil(SUMMARY_CHAR_BUDGET / 3);

// 按会话单飞:同一会话同一时间只允许一个压缩任务在跑。
const running = new Set<string>();

function tokensOfTurns(turns: Turn[]): number {
  return estimateTokens(formatTurns(turns));
}

// 决定切分点:从最新往回保留尽量多的原文,使(摘要预留 + 保留原文)≤ lowBudget,
// 且至少保留 MIN_VERBATIM_TURNS 轮。返回要折叠进摘要的「最老一批」轮次(可能为空)。
// 导出仅为单测边界行为。
export function pickFoldTurns(turns: Turn[], lowBudget: number): Turn[] {
  const minKeep = Math.min(MIN_VERBATIM_TURNS, turns.length);
  let keptTokens = SUMMARY_RESERVE;
  let keepCount = 0;
  // 从最新一轮往老的方向累加,直到再加一轮会超出 lowBudget。
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = tokensOfTurns([turns[i]]);
    const isWithinMin = keepCount < minKeep;
    if (!isWithinMin && keptTokens + t > lowBudget) break;
    keptTokens += t;
    keepCount += 1;
  }
  const foldCount = turns.length - keepCount;
  return foldCount > 0 ? turns.slice(0, foldCount) : [];
}

async function runJob(conversationId: string): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;

  const config = loadConfig();
  const limit = getContextLimit(config);
  const highBudget = limit * HIGH_WATER - NON_HISTORY_RESERVE;
  const lowBudget = limit * LOW_WATER - NON_HISTORY_RESERVE;
  if (lowBudget <= 0) return; // 上限小得离谱,压缩也救不了,放弃。

  const { summary, throughId } = await getSummary(conversationId);
  const verbatim = await getTurnsAfterId(conversationId, throughId);

  const currentTokens = estimateTokens(summary ?? "") + tokensOfTurns(verbatim);
  if (currentTokens <= highBudget) return; // 还没逼近上限,不压。

  const foldTurns = pickFoldTurns(verbatim, lowBudget);
  if (foldTurns.length === 0) return; // 已经压无可压(全在保留窗口内)。

  let newSummary: string;
  try {
    newSummary = await summarizeConversation(provider, {
      targetLanguage: config.targetLanguage,
      priorSummary: summary ?? "",
      newTurns: formatTurns(foldTurns),
      charBudget: SUMMARY_CHAR_BUDGET,
    });
  } catch (e) {
    // 失败不推进水位,下次连同这批一起重试(与维护 agent 一致)。
    logError("summary", "摘要生成失败", e);
    return;
  }
  if (!newSummary.trim()) return; // 空摘要不推进水位,避免丢内容。

  const newThroughId = foldTurns[foldTurns.length - 1].id;
  await setSummary(conversationId, newSummary, newThroughId);
}

// 每轮持久化后调用。后台跑,单飞(按会话),绝不阻塞热路径、绝不抛。
export async function maybeCompressConversation(
  conversationId: string,
): Promise<void> {
  if (running.has(conversationId)) return;
  running.add(conversationId);
  try {
    await runJob(conversationId);
  } catch (e) {
    logError("summary", "压缩任务异常", e);
  } finally {
    running.delete(conversationId);
  }
}
