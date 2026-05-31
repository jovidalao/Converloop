import { count, desc, eq, gt, sql } from "drizzle-orm";
import type { TutorAnalysis } from "../agents/schema";
import { db } from "./client";
import { normalizeKey } from "./mastery-logic";
import { type Turn, turn } from "./schema";

export async function persistTurn(
  conversationId: string,
  userInput: string,
  reply: string,
  analysis: TutorAnalysis | null,
  id = crypto.randomUUID(),
): Promise<string> {
  await db.insert(turn).values({
    id,
    createdAt: Date.now(),
    userInput,
    reply,
    analysisJson: analysis ? JSON.stringify(analysis) : null,
    conversationId,
  });
  return id;
}

export async function updateTurnAnalysis(
  id: string,
  analysis: TutorAnalysis | null,
  prose?: string | null,
): Promise<void> {
  await db
    .update(turn)
    .set({ analysisJson: serializeTurnFeedback(analysis, prose) })
    .where(eq(turn.id, id));
}

const PROSE_FEEDBACK_MARKER = "__prose_feedback";

export interface ChatTurn {
  id: string;
  userText: string;
  partnerText?: string;
  analysis: TutorAnalysis | null;
  analysisProse?: string | null;
  analysisPending?: boolean;
  analysisError?: string | null;
}

export function serializeTurnFeedback(
  analysis: TutorAnalysis | null,
  prose?: string | null,
): string | null {
  if (analysis) return JSON.stringify(analysis);
  if (prose?.trim()) {
    return JSON.stringify({
      [PROSE_FEEDBACK_MARKER]: true,
      body: prose.trim(),
    });
  }
  return null;
}

function parseStructuredAnalysisJson(json: string): TutorAnalysis | null {
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (v[PROSE_FEEDBACK_MARKER] === true) return null;
    return v as TutorAnalysis;
  } catch {
    return null;
  }
}

export function parseTurnFeedback(json: string | null): {
  analysis: TutorAnalysis | null;
  prose: string | null;
} {
  if (!json) return { analysis: null, prose: null };
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (v[PROSE_FEEDBACK_MARKER] === true && typeof v.body === "string") {
      return { analysis: null, prose: v.body };
    }
    return { analysis: parseStructuredAnalysisJson(json), prose: null };
  } catch {
    return { analysis: null, prose: null };
  }
}

// 从 DB 恢复某会话的聊天(时间正序),供 ChatView 挂载时加载。
export async function loadChatHistory(
  conversationId: string,
  limit = 200,
): Promise<ChatTurn[]> {
  const turns = await getRecentTurnsForConversation(conversationId, limit);
  return turns.map((t) => {
    const { analysis, prose } = parseTurnFeedback(t.analysisJson);
    return {
      id: t.id,
      userText: t.userInput,
      partnerText: t.reply,
      analysis,
      analysisProse: prose,
    };
  });
}

export function parseTurnAnalysis(json: string | null): TutorAnalysis | null {
  return parseTurnFeedback(json).analysis;
}

// 全局最近 turns(跨会话)。维护 agent 的 getRecentlyIntroduced 用,刻意不按会话隔离。
export async function getRecentTurns(limit = 6): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse(); // 时间正序,喂 prompt 更自然
}

export async function getTurnsSince(
  sinceMs: number,
  limit = 24,
): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .where(gt(turn.createdAt, sinceMs))
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse();
}

// 某会话内的最近 turns。对话/导师 agent 的上下文按会话隔离,话题不串。
export async function getRecentTurnsForConversation(
  conversationId: string,
  limit = 6,
): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .where(eq(turn.conversationId, conversationId))
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse(); // 时间正序,喂 prompt 更自然
}

// 历史里某轮的"用户行":母语/混说轮(有 expression_gap)用导师转换出的地道目标语,
// 让后续对话在目标语里连贯延续;否则用原始输入。
function userLineForHistory(t: Turn): string {
  const { analysis } = parseTurnFeedback(t.analysisJson);
  const target = analysis?.expression_gap?.target_expression?.trim();
  return target || t.userInput;
}

// 把某会话最近几轮格式化成对话 / 导师 agent 都能用的历史文本。
export async function formatRecentHistory(
  conversationId: string,
  limit = 6,
): Promise<string> {
  const turns = await getRecentTurnsForConversation(conversationId, limit);
  return turns
    .map((t) => {
      const user = userLineForHistory(t).trim();
      return user
        ? `User: ${user}\nPartner: ${t.reply}`
        : `Partner: ${t.reply}`;
    })
    .join("\n\n");
}

// 维护 agent 的增量转写:只取上次维护之后(createdAt > sinceMs)的 turns,避免
// 每次都重嚼老内容(反复重写 About me、缓慢漂移)。跨会话不隔离(档案是全局的)。
// 再按字符预算从最近往回截断,粗略对应 token 预算,防止长 turn 撑爆上下文。
export async function formatHistorySince(
  sinceMs: number,
  charBudget: number,
  maxTurns = 100,
): Promise<string> {
  const rows = await db
    .select()
    .from(turn)
    .where(gt(turn.createdAt, sinceMs))
    .orderBy(desc(turn.createdAt))
    .limit(maxTurns);
  const lines: string[] = [];
  let used = 0;
  for (const t of rows) {
    const line = `User: ${t.userInput}\nPartner: ${t.reply}`;
    if (used + line.length > charBudget && lines.length > 0) break;
    lines.push(line);
    used += line.length;
  }
  return lines.reverse().join("\n\n"); // 时间正序,喂 prompt 更自然
}

// 理解信号:用户在某条回复上点「讲解」/「双语阅读」时 +1(仅用户主动触发,
// 自动展开的双语不算)。原子自增,best-effort——计错一次不影响主链路。
export async function incrementExplainCount(id: string): Promise<void> {
  await db
    .update(turn)
    .set({ explainCount: sql`${turn.explainCount} + 1` })
    .where(eq(turn.id, id));
}

export async function incrementBilingualCount(id: string): Promise<void> {
  await db
    .update(turn)
    .set({ bilingualCount: sql`${turn.bilingualCount} + 1` })
    .where(eq(turn.id, id));
}

export async function getTurnCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(turn);
  return row?.n ?? 0;
}

// 从近期 turns 的分析里抽 "introduced" 项,去重(给维护 agent 的"最近学到")。
export async function getRecentlyIntroduced(
  limit = 12,
): Promise<{ key: string; label: string }[]> {
  const turns = await getRecentTurns(limit);
  const seen = new Map<string, string>();
  for (const t of turns) {
    const { analysis: a } = parseTurnFeedback(t.analysisJson);
    if (!a) continue;
    for (const u of a.mastery_updates) {
      if (u.signal === "introduced") seen.set(normalizeKey(u.key), u.label);
    }
    for (const item of a.expression_gap?.key_items ?? []) {
      seen.set(normalizeKey(item.mastery_key), item.mastery_label);
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}
