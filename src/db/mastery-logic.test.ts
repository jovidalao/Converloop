import { describe, it, expect } from "vitest";
import { applySignal, deriveSignals } from "./mastery-logic";
import type { TutorAnalysis } from "../agents/schema";

describe("applySignal", () => {
  it("seen_count < 3 一律 learning", () => {
    const a = applySignal({ seenCount: 0, errorCount: 0 }, "error", 1);
    expect(a).toMatchObject({ seenCount: 1, errorCount: 1, status: "learning" });
    const b = applySignal({ seenCount: 1, errorCount: 1 }, "error", 1);
    expect(b.status).toBe("learning");
  });

  it("错误率高 → struggling", () => {
    // 连错 3 次:seen=3 err=3 errRate=1 > 0.4
    let c = { seenCount: 2, errorCount: 2 };
    const r = applySignal(c, "error", 1);
    expect(r).toMatchObject({ seenCount: 3, errorCount: 3, status: "struggling" });
  });

  it("错误率低 → known", () => {
    // seen=3 err=0 errRate=0 < 0.15
    const r = applySignal({ seenCount: 2, errorCount: 0 }, "correct", 1);
    expect(r).toMatchObject({ seenCount: 3, errorCount: 0, status: "known" });
  });

  it("correct/introduced 不增 error_count", () => {
    expect(applySignal({ seenCount: 5, errorCount: 2 }, "correct").errorCount).toBe(2);
    expect(applySignal({ seenCount: 5, errorCount: 2 }, "introduced").errorCount).toBe(2);
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
      { key: "vocab:apple", label: "apple", type: "vocab", signal: "introduced" },
    ],
  };

  it("issues → error 信号,mastery_updates → 其声明的信号", () => {
    const sigs = deriveSignals(analysis);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toMatchObject({ key: "grammar:article_usage", kind: "error", example: "a apple" });
    expect(sigs[1]).toMatchObject({ key: "vocab:apple", kind: "introduced" });
  });
});
