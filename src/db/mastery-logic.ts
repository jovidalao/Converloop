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
  payload?: unknown; // 原始结构化证据,写入 mastery_event 供审计 / 重算
}

export interface MasteryCounters {
  seenCount: number;
  errorCount: number;
  status: MasteryStatus;
  lastSeenAt: number;
}

export interface RetentionInput {
  seenCount: number;
  errorCount: number;
  status: MasteryStatus;
  lastSeenAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// mastery_key 是掌握系统的地基:同一类错跨句必须同一个 key。LLM 偶尔会大小写/空格
// 漂移(grammar:Article usage ↔ grammar:article_usage),不规整会悄悄分叉成两条记录、
// 稀释计数。写入前在代码侧统一收口(deriveSignals 是所有信号的必经之路)。
export function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/_*:_*/g, ":") // 冒号(type 前缀分隔)两侧不留下划线
    .replace(/^_|_$/g, "");
}

export function statusFromCounts(
  seenCount: number,
  errorCount: number,
): MasteryStatus {
  if (seenCount < 3) return "learning";
  const errRate = errorCount / seenCount;
  if (errRate > 0.4) return "struggling";
  if (errRate < 0.15) return "known";
  return "learning";
}

export function retentionStrengthDays(input: RetentionInput): number {
  const correctCount = Math.max(0, input.seenCount - input.errorCount);
  const accuracy = input.seenCount > 0 ? correctCount / input.seenCount : 0;
  const statusBoost =
    input.status === "known" ? 4 : input.status === "learning" ? 1 : 0;
  const raw =
    1 +
    correctCount * 1.6 +
    accuracy * 2 +
    statusBoost -
    input.errorCount * 0.5;
  return clamp(raw, 0.75, 30);
}

export function retentionScore(
  input: RetentionInput,
  now: number = Date.now(),
): number {
  if (!Number.isFinite(input.lastSeenAt) || input.lastSeenAt <= 0) return 0;
  const elapsedDays = Math.max(0, (now - input.lastSeenAt) / DAY_MS);
  return clamp(Math.exp(-elapsedDays / retentionStrengthDays(input)), 0, 1);
}

export function dueReviewScore(
  input: RetentionInput,
  now: number = Date.now(),
): number {
  const retention = retentionScore(input, now);
  const errorRate =
    input.seenCount > 0 ? input.errorCount / input.seenCount : 0.5;
  const statusNeed =
    input.status === "struggling"
      ? 1.25
      : input.status === "learning"
        ? 1
        : 0.7;
  return (1 - retention) * statusNeed + errorRate * 0.35;
}

// 见 docs/tutor-agent.md#代码侧记账。公式以后可调,关键是它在代码里、可测。
export function applySignal(
  prev: Pick<MasteryCounters, "seenCount" | "errorCount">,
  kind: SignalKind,
  now: number = Date.now(),
): MasteryCounters {
  // introduced = 老师/批改新引入,只是曝光证据,不是用户产出证据。
  // 它更新 lastSeenAt、保留学习项,但不推动 struggling→known。
  if (kind === "introduced") {
    return {
      seenCount: prev.seenCount,
      errorCount: prev.errorCount,
      status: statusFromCounts(prev.seenCount, prev.errorCount),
      lastSeenAt: now,
    };
  }

  const seenCount = prev.seenCount + 1;
  // gap 与 error 一样算负面证据:用户没能产出 → 推向 struggling。
  const errorCount =
    prev.errorCount + (kind === "error" || kind === "gap" ? 1 : 0);
  const status = statusFromCounts(seenCount, errorCount);
  return { seenCount, errorCount, status, lastSeenAt: now };
}

// issues[] → error 信号(span_original 当作真实出错证据);
// mastery_updates[] → correct / introduced 信号。
// 错误信号只从 issues 派生,绝不让 LLM 在 mastery_updates 里重复上报。
export function deriveSignals(analysis: TutorAnalysis): Signal[] {
  const signals: Signal[] = [];
  // 同一轮里某个 key 一旦被负面证据(error/gap)或更早的信号占用,后续 correct/
  // introduced 不得再为它计一次:否则同一条消息既报错又报对,会把 seenCount 多加、
  // 把错误率冲淡。issues 之间不去重(重复出错 = 真实的重复证据)。
  const claimed = new Set<string>();
  for (const issue of analysis.issues) {
    const key = normalizeKey(issue.mastery_key);
    signals.push({
      key,
      label: issue.mastery_label,
      type: issue.mastery_type,
      kind: "error",
      example: issue.span_original,
      payload: { issue },
    });
    claimed.add(key);
  }
  for (const update of analysis.mastery_updates) {
    const key = normalizeKey(update.key);
    if (claimed.has(key)) continue; // error 优先;重复 update 也去重
    signals.push({
      key,
      label: update.label,
      type: update.type,
      kind: update.signal,
      example: update.evidence,
      payload: { mastery_update: update },
    });
    claimed.add(key);
  }
  // 表达缺口:情景本身记一个 gap 信号(存原句 + 地道说法),关键词走 introduced。
  const gap = analysis.expression_gap;
  if (gap) {
    const gapKey = normalizeKey(gap.mastery_key);
    if (!claimed.has(gapKey)) {
      signals.push({
        key: gapKey,
        label: gap.mastery_label,
        type: "expression_gap",
        kind: "gap",
        example: gap.original, // 最重要:用户说不出的原句
        note: gap.target_expression,
        payload: { expression_gap: gap },
      });
      claimed.add(gapKey);
    }
    for (const item of gap.key_items) {
      const key = normalizeKey(item.mastery_key);
      if (claimed.has(key)) continue;
      signals.push({
        key,
        label: item.mastery_label,
        type: item.mastery_type,
        kind: "introduced",
        example: item.text,
        payload: { key_item: item, expression_gap_key: gapKey },
      });
      claimed.add(key);
    }
  }
  return signals;
}
