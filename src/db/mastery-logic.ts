import type { TutorAnalysis } from "../agents/schema";

// 纯逻辑:不碰 DB、不碰 Tauri,可单测。LLM 给离散信号,这里算计数/状态。
export type SignalKind = "error" | "correct" | "introduced";
export type MasteryStatus = "struggling" | "learning" | "known";
export type MasteryType = "vocab" | "grammar" | "collocation" | "error_pattern";

export interface Signal {
  key: string;
  label: string;
  type: MasteryType;
  kind: SignalKind;
  example?: string;
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
  const errorCount = prev.errorCount + (kind === "error" ? 1 : 0);
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
  return signals;
}
