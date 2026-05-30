import type { TutorAnalysis } from "../agents/schema";

// 纯逻辑:不碰 DB、不碰 Tauri,可单测。LLM 给离散信号,这里算计数/状态。
// "gap" = 用户没能用目标语产出(母语/混说),区别于 "error"(产出了但错了)。
export type SignalKind = "error" | "correct" | "introduced" | "gap";
export type MasteryStatus = "struggling" | "learning" | "known";
export type MasteryType =
  | "vocab"
  | "grammar"
  | "collocation"
  | "error_pattern"
  | "expression_gap";

export interface Signal {
  key: string;
  label: string;
  type: MasteryType;
  kind: SignalKind;
  example?: string;
  note?: string; // 额外存到 mastery_item.notes(如表达缺口的地道说法)
}

export interface MasteryCounters {
  seenCount: number;
  errorCount: number;
  status: MasteryStatus;
  lastSeenAt: number;
}

// 见 docs/tutor-agent.md#代码侧记账。公式以后可调,关键是它在代码里、可测。
export function applySignal(
  prev: Pick<MasteryCounters, "seenCount" | "errorCount">,
  kind: SignalKind,
  now: number = Date.now(),
): MasteryCounters {
  const seenCount = prev.seenCount + 1;
  // gap 与 error 一样算负面证据:用户没能产出 → 推向 struggling。
  const errorCount = prev.errorCount + (kind === "error" || kind === "gap" ? 1 : 0);
  const errRate = errorCount / seenCount;
  const status: MasteryStatus =
    seenCount < 3
      ? "learning"
      : errRate > 0.4
        ? "struggling"
        : errRate < 0.15
          ? "known"
          : "learning";
  return { seenCount, errorCount, status, lastSeenAt: now };
}

// issues[] → error 信号(span_original 当作真实出错证据);
// mastery_updates[] → correct / introduced 信号。
// 错误信号只从 issues 派生,绝不让 LLM 在 mastery_updates 里重复上报。
export function deriveSignals(analysis: TutorAnalysis): Signal[] {
  const signals: Signal[] = [];
  for (const issue of analysis.issues) {
    signals.push({
      key: issue.mastery_key,
      label: issue.mastery_label,
      type: issue.mastery_type,
      kind: "error",
      example: issue.span_original,
    });
  }
  for (const update of analysis.mastery_updates) {
    signals.push({
      key: update.key,
      label: update.label,
      type: update.type,
      kind: update.signal,
      example: update.evidence,
    });
  }
  // 表达缺口:情景本身记一个 gap 信号(存原句 + 地道说法),关键词走 introduced。
  const gap = analysis.expression_gap;
  if (gap) {
    signals.push({
      key: gap.mastery_key,
      label: gap.mastery_label,
      type: "expression_gap",
      kind: "gap",
      example: gap.original, // 最重要:用户说不出的原句
      note: gap.target_expression,
    });
    for (const item of gap.key_items) {
      signals.push({
        key: item.mastery_key,
        label: item.mastery_label,
        type: item.mastery_type,
        kind: "introduced",
        example: item.text,
      });
    }
  }
  return signals;
}
