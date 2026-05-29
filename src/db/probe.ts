import { recordAnalysis, getAllMastery, getWeakList } from "./mastery";
import { persistTurn, getRecentTurns } from "./turns";
import type { TutorAnalysis } from "../agents/schema";
import type { MasteryItem, Turn } from "./schema";
import type { WeakItem } from "../agents/tutor";

export type ProbeResult =
  | { ok: true; rows: MasteryItem[]; weak: WeakItem[]; turns: Turn[]; note: string }
  | { ok: false; error: string };

// 一个模拟的导师分析(真实错句),用来验证记账链路。
const SAMPLE: TutorAnalysis = {
  is_correct: false,
  corrected: "I have an apple and I went to school yesterday.",
  natural: "I had an apple and went to school yesterday.",
  issues: [
    {
      category: "grammar",
      span_original: "a apple",
      span_corrected: "an apple",
      explanation: "元音音素前用 an。",
      severity: "minor",
      mastery_key: "grammar:article_usage",
      mastery_label: "冠词 a/an/the 的用法",
      mastery_type: "grammar",
    },
    {
      category: "grammar",
      span_original: "I go to school yesterday",
      span_corrected: "I went to school yesterday",
      explanation: "yesterday 表过去,用过去式。",
      severity: "moderate",
      mastery_key: "grammar:past_tense",
      mastery_label: "一般过去时",
      mastery_type: "grammar",
    },
  ],
  mastery_updates: [
    { key: "vocab:apple", label: "apple", type: "vocab", signal: "introduced" },
  ],
};

// Task 4 探针:跑两轮记账,验证计数/状态正确,同 key 第二轮是 update 不新增。
export async function runBookkeepingProbe(): Promise<ProbeResult> {
  try {
    await recordAnalysis(SAMPLE); // 第一轮
    await recordAnalysis(SAMPLE); // 第二轮:同样的 key,应 update
    const rows = await getAllMastery();
    const weak = await getWeakList();
    // Task 6 持久化层:存一轮、读回。
    await persistTurn("I have a apple.", "Nice! What kind of apple?", SAMPLE);
    const turns = await getRecentTurns();
    return { ok: true, rows, weak, turns, note: "记账两轮 + 持久化一轮完成" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
