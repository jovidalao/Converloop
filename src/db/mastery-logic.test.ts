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
  it("case and whitespace drift converges to the same key", () => {
    expect(normalizeKey("Grammar:Article_Usage")).toBe("grammar:article_usage");
    expect(normalizeKey("  grammar:article usage  ")).toBe(
      "grammar:article_usage",
    );
    expect(normalizeKey("collocation:make  vs  do")).toBe(
      "collocation:make_vs_do",
    );
  });

  it("no underscores left adjacent to the colon", () => {
    expect(normalizeKey("gap: decline request politely")).toBe(
      "gap:decline_request_politely",
    );
  });
});

describe("applySignal", () => {
  it("seen_count < 3 always yields learning", () => {
    const a = applySignal({ seenCount: 0, errorCount: 0 }, "error", 1);
    expect(a).toMatchObject({
      seenCount: 1,
      errorCount: 1,
      status: "learning",
    });
    const b = applySignal({ seenCount: 1, errorCount: 1 }, "error", 1);
    expect(b.status).toBe("learning");
  });

  it("high error rate → struggling", () => {
    // 3 consecutive errors: seen=3 err=3 errRate=1 > 0.4
    const c = { seenCount: 2, errorCount: 2 };
    const r = applySignal(c, "error", 1);
    expect(r).toMatchObject({
      seenCount: 3,
      errorCount: 3,
      status: "struggling",
    });
  });

  it("low error rate → known", () => {
    // seen=3 err=0 errRate=0 < 0.15
    const r = applySignal({ seenCount: 2, errorCount: 0 }, "correct", 1);
    expect(r).toMatchObject({ seenCount: 3, errorCount: 0, status: "known" });
  });

  it("correct does not increment error_count", () => {
    expect(
      applySignal({ seenCount: 5, errorCount: 2 }, "correct").errorCount,
    ).toBe(2);
  });

  it("introduced counts as an exposure only — does not increment seen_count/error_count and does not push to known", () => {
    const r = applySignal({ seenCount: 2, errorCount: 0 }, "introduced", 1);
    expect(r).toMatchObject({
      seenCount: 2,
      errorCount: 0,
      status: "learning",
      lastSeenAt: 1,
    });
  });

  it("gap increments error_count just like error", () => {
    expect(applySignal({ seenCount: 5, errorCount: 2 }, "gap").errorCount).toBe(
      3,
    );
  });
});

describe("retention", () => {
  const day = 24 * 60 * 60 * 1000;

  it("more correct evidence yields higher strength", () => {
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

  it("decays over time", () => {
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

  it("when equally overdue, the item with higher error rate has a higher due score", () => {
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
        mastery_label: "Article usage",
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

  it("issues → error signals; mastery_updates → their declared signals", () => {
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

  it("same key in both issues and mastery_updates → error takes priority, no duplicate", () => {
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
          mastery_label: "Article usage",
          mastery_type: "grammar",
        },
      ],
      mastery_updates: [
        {
          key: "grammar:article_usage", // same key reported correct again — should be discarded
          label: "Article usage",
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
          key: "vocab:apple", // duplicate update — should be deduplicated
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

  it("expression_gap → records a gap signal (stores original sentence), key_items go as introduced", () => {
    const withGap: TutorAnalysis = {
      is_correct: true,
      corrected: "",
      natural: "",
      issues: [],
      mastery_updates: [],
      expression_gap: {
        mastery_key: "gap:decline_request_politely",
        mastery_label: "Politely declining a request",
        original: "I want to decline this request politely",
        target_expression:
          "I'd rather not take this on right now, but I could help later.",
        explanation:
          "Use 'I'd rather not ___, but ___' to soften the refusal and offer an alternative.",
        key_items: [
          {
            text: "I'd rather not",
            gloss: "I'd prefer not to",
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
      example: "I want to decline this request politely",
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
