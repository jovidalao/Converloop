import { describe, expect, it } from "vitest";
import type { TutorAnalysis } from "../agents/schema";
import { applySignal, deriveSignals } from "./mastery-logic";

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

  it("correct/introduced 不增 error_count", () => {
    expect(
      applySignal({ seenCount: 5, errorCount: 2 }, "correct").errorCount,
    ).toBe(2);
    expect(
      applySignal({ seenCount: 5, errorCount: 2 }, "introduced").errorCount,
    ).toBe(2);
  });

  it("gap 与 error 一样增 error_count", () => {
    expect(applySignal({ seenCount: 5, errorCount: 2 }, "gap").errorCount).toBe(
      3,
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
  };

  it("issues → error 信号,mastery_updates → 其声明的信号", () => {
    const sigs = deriveSignals(analysis);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toMatchObject({
      key: "grammar:article_usage",
      kind: "error",
      example: "a apple",
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
    });
    expect(sigs[1]).toMatchObject({
      key: "collocation:would_rather_not",
      kind: "introduced",
    });
  });
});
