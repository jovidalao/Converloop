import { desc, count } from "drizzle-orm";
import { db } from "./client";
import { turn, type Turn } from "./schema";
import type { TutorAnalysis } from "../agents/schema";

export async function persistTurn(
  userInput: string,
  reply: string,
  analysis: TutorAnalysis | null,
): Promise<void> {
  await db.insert(turn).values({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    userInput,
    reply,
    analysisJson: analysis ? JSON.stringify(analysis) : null,
  });
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
    if (!t.analysisJson) continue;
    try {
      const a = JSON.parse(t.analysisJson) as TutorAnalysis;
      for (const u of a.mastery_updates) {
        if (u.signal === "introduced") seen.set(u.key, u.label);
      }
    } catch {
      // 坏 JSON 跳过
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}
