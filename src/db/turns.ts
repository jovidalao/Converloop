import { desc, count, eq } from "drizzle-orm";
import { db } from "./client";
import { turn, type Turn } from "./schema";
import type { TutorAnalysis } from "../agents/schema";

export async function persistTurn(
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
    return JSON.stringify({ [PROSE_FEEDBACK_MARKER]: true, body: prose.trim() });
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

// 从 DB 恢复聊天(时间正序),供 ChatView 挂载时加载。
export async function loadChatHistory(limit = 200): Promise<ChatTurn[]> {
  const turns = await getRecentTurns(limit);
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

export async function getRecentTurns(limit = 6): Promise<Turn[]> {
  const rows = await db
    .select()
    .from(turn)
    .orderBy(desc(turn.createdAt))
    .limit(limit);
  return rows.reverse(); // 时间正序,喂 prompt 更自然
}

// 把最近几轮格式化成对话 / 导师 agent 都能用的历史文本。
export async function formatRecentHistory(limit = 6): Promise<string> {
  const turns = await getRecentTurns(limit);
  return turns.map((t) => `User: ${t.userInput}\nPartner: ${t.reply}`).join("\n\n");
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
      if (u.signal === "introduced") seen.set(u.key, u.label);
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}
