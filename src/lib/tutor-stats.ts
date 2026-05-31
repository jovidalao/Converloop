import { logDebug } from "./log";

// 导师结构化输出的健康度:JSON 解析成功 vs 回退到纯文本 vs 整体失败。
// 回退/失败路径只展示批改、不入 mastery 账(见 orchestrator),所以高回退率 =
// 掌握系统在悄悄退化、复习信号在流失。进程内累计便于观察,不持久化。
export interface TutorStats {
  structured: number;
  prose: number;
  failed: number;
}

export type TutorOutcome = keyof TutorStats;

const stats: TutorStats = { structured: 0, prose: 0, failed: 0 };

// 「批改可见但没记账」的占比(prose + failed)。
export function degradedRate(s: TutorStats): number {
  const total = s.structured + s.prose + s.failed;
  return total === 0 ? 0 : (s.prose + s.failed) / total;
}

export function recordTutorOutcome(outcome: TutorOutcome): void {
  stats[outcome]++;
  const total = stats.structured + stats.prose + stats.failed;
  const rate = degradedRate(stats);
  // 累计回退率偏高时直接 warn(不挡 debug 开关),否则只在 debug 下记一行。
  if (outcome !== "structured" && total >= 5 && rate >= 0.2) {
    console.warn(
      `[tutor] 结构化批改回退率偏高:${stats.prose + stats.failed}/${total}(${Math.round(rate * 100)}%)——这些轮次未计入 mastery`,
    );
  } else {
    logDebug(
      "tutor",
      `outcome=${outcome} structured=${stats.structured} prose=${stats.prose} failed=${stats.failed}`,
    );
  }
}

export function getTutorStats(): Readonly<TutorStats> {
  return stats;
}
