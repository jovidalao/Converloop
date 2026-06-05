import { describe, expect, it } from "vitest";
import type { TutorAnalysis } from "../agents/schema";
import {
  applySignal,
  deriveSignals,
  dueReviewScore,
  normalizeKey,
  retentionScore,
  retentionStrengthDays,
} from "./mastery-logic";

describe("normalizeKey", () => {
  it("大小写 / 空格漂移收敛到同一个 key", () => {
    expect(normalizeKey("Grammar:Article_Usage")).toBe("grammar:article_usage");
    expect(normalizeKey("  grammar:article usage  ")).toBe(
      "grammar:article_usage",
    );
    expect(normalizeKey("collocation:make  vs  do")).toBe(
      "collocation:make_vs_do",
    );
  });

  it("冒号两侧不留下划线", () => {
    expect(normalizeKey("gap: decline request politely")).toBe(
      "gap:decline_request_politely",
    );
  });
});

describe("applySignal", () => {
  it("seen_count < 3 一律 learning", () => {
    const a = applySignal({ seenCount: 0, errorCount: 0 }, "error", 1);
    expect(a).toMatchObject({
      seenCount: 1,
      errorCount: 1,
      status: "learning",
    });
    const b = applySignal({ seenCount: 1, errorCount: 1 }, "error", 1);
    expect(b.status).toBe("learning");
  });

  it("错误率高 → struggling", () => {
    // 连错 3 次:seen=3 err=3 errRate=1 > 0.4
    const c = { seenCount: 2, errorCount: 2 };
    const r = applySignal(c, "error", 1);
    expect(r).toMatchObject({
      seenCount: 3,
      errorCount: 3,
      status: "struggling",
    });
  });

  it("错误率低 → known", () => {
    // seen=3 err=0 errRate=0 < 0.15
    const r = applySignal({ seenCount: 2, errorCount: 0 }, "correct", 1);
    expect(r).toMatchObject({ seenCount: 3, errorCount: 0, status: "known" });
  });

  it("correct 不增 error_count", () => {
    expect(
      applySignal({ seenCount: 5, errorCount: 2 }, "correct").errorCount,
    ).toBe(2);
  });

  it("introduced 只算曝光,不增加 seen_count/error_count,也不推动 known", () => {
    const r = applySignal({ seenCount: 2, errorCount: 0 }, "introduced", 1);
    expect(r).toMatchObject({
      seenCount: 2,
      errorCount: 0,
      status: "learning",
      lastSeenAt: 1,
    });
  });

  it("gap 与 error 一样增 error_count", () => {
    expect(applySignal({ seenCount: 5, errorCount: 2 }, "gap").errorCount).toBe(
      3,
    );
  });
});

describe("retention", () => {
  const day = 24 * 60 * 60 * 1000;

  it("correct 证据越多,strength 越高", () => {
    const weak = retentionStrengthDays({
      seenCount: 3,
      errorCount: 2,
      status: "struggling",
      lastSeenAt: 0,
    });
    const strong = retentionStrengthDays({
      seenCount: 8,
      errorCount: 1,
      status: "known",
      lastSeenAt: 0,
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it("随时间衰减", () => {
    const input = {
      seenCount: 4,
      errorCount: 1,
      status: "learning" as const,
      lastSeenAt: 1_000,
    };
    expect(retentionScore(input, 1_000 + day)).toBeGreaterThan(
      retentionScore(input, 1_000 + 10 * day),
    );
  });

  it("同样久未复习时,错误率高的项 due score 更高", () => {
    const now = 1_000 + 7 * day;
    const correctLeaning = {
      seenCount: 6,
      errorCount: 1,
      status: "learning" as const,
      lastSeenAt: 1_000,
    };
    const errorLeaning = {
      seenCount: 6,
      errorCount: 5,
      status: "struggling" as const,
      lastSeenAt: 1_000,
    };
    expect(dueReviewScore(errorLeaning, now)).toBeGreaterThan(
      dueReviewScore(correctLeaning, now),
    );
  });
});

describe("deriveSignals", () => {
  const analysis: TutorAnalysis = {
    is_correct: false,
    corrected: "I have an apple.",
    natural: "I have an apple.",
    issues: [
      {
        category: "grammar",
        span_original: "a apple",
        span_corrected: "an apple",
        explanation: "...",
        severity: "minor",
        mastery_key: "grammar:article_usage",
        mastery_label: "冠词",
        mastery_type: "grammar",
      },
    ],
    mastery_updates: [
      {
        key: "vocab:apple",
        label: "apple",
        type: "vocab",
        signal: "introduced",
      },
    ],
    expression_gap: null,
  };

  it("issues → error 信号,mastery_updates → 其声明的信号", () => {
    const sigs = deriveSignals(analysis);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toMatchObject({
      key: "grammar:article_usage",
      kind: "error",
      example: "a apple",
      payload: {
        issue: expect.objectContaining({
          mastery_key: "grammar:article_usage",
        }),
      },
    });
    expect(sigs[1]).toMatchObject({
      key: "vocab:apple",
      kind: "introduced",
      payload: {
        mastery_update: expect.objectContaining({ key: "vocab:apple" }),
      },
    });
  });

  it("同一 key 既在 issues 又在 mastery_updates → error 优先,不重复计", () => {
    const dup: TutorAnalysis = {
      is_correct: false,
      corrected: "...",
      natural: "...",
      issues: [
        {
          category: "grammar",
          span_original: "a apple",
          span_corrected: "an apple",
          explanation: "...",
          severity: "minor",
          mastery_key: "grammar:article_usage",
          mastery_label: "冠词",
          mastery_type: "grammar",
        },
      ],
      mastery_updates: [
        {
          key: "grammar:article_usage", // 同 key 又报 correct —— 应被丢弃
          label: "冠词",
          type: "grammar",
          signal: "correct",
        },
        {
          key: "vocab:apple",
          label: "apple",
          type: "vocab",
          signal: "introduced",
        },
        {
          key: "vocab:apple", // 重复 update —— 应去重
          label: "apple",
          type: "vocab",
          signal: "introduced",
        },
      ],
      expression_gap: null,
    };
    const sigs = deriveSignals(dup);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toMatchObject({
      key: "grammar:article_usage",
      kind: "error",
    });
    expect(sigs[1]).toMatchObject({ key: "vocab:apple", kind: "introduced" });
  });

  it("expression_gap → 情景记 gap 信号(存原句),key_items 走 introduced", () => {
    const withGap: TutorAnalysis = {
      is_correct: true,
      corrected: "",
      natural: "",
      issues: [],
      mastery_updates: [],
      expression_gap: {
        mastery_key: "gap:decline_request_politely",
        mastery_label: "委婉拒绝请求",
        original: "我想委婉地拒绝这个请求",
        target_expression:
          "I'd rather not take this on right now, but I could help later.",
        explanation: "用 'I'd rather not ___, but ___' 句式先婉拒再给替代。",
        key_items: [
          {
            text: "I'd rather not",
            gloss: "我不太想",
            mastery_key: "collocation:would_rather_not",
            mastery_label: "would rather not",
            mastery_type: "collocation",
          },
        ],
      },
    };
    const sigs = deriveSignals(withGap);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toMatchObject({
      key: "gap:decline_request_politely",
      type: "expression_gap",
      kind: "gap",
      example: "我想委婉地拒绝这个请求",
      note: "I'd rather not take this on right now, but I could help later.",
      payload: {
        expression_gap: expect.objectContaining({
          mastery_key: "gap:decline_request_politely",
        }),
      },
    });
    expect(sigs[1]).toMatchObject({
      key: "collocation:would_rather_not",
      kind: "introduced",
      payload: {
        key_item: expect.objectContaining({
          mastery_key: "collocation:would_rather_not",
        }),
        expression_gap_key: "gap:decline_request_politely",
      },
    });
  });
});
