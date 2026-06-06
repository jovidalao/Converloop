import { describe, expect, it } from "vitest";
import {
  extractJsonText,
  normalizeTutorPayload,
  parseLLMJson,
} from "./parse-llm-json";
import { TutorAnalysis } from "./schema";

describe("extractJsonText", () => {
  it("strips markdown fences", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("does not guess-extract objects from mixed text", () => {
    expect(extractJsonText('Here:\n{"a":1}\nDone')).toBe(
      'Here:\n{"a":1}\nDone',
    );
  });
});

describe("normalizeTutorPayload", () => {
  it("normalizes enum casing", () => {
    const normalized = normalizeTutorPayload({
      is_correct: false,
      corrected: "x",
      natural: "x",
      issues: [
        {
          category: "Grammar",
          span_original: "a",
          span_corrected: "b",
          explanation: "e",
          severity: "Minor",
          mastery_key: "grammar:x",
          mastery_label: "l",
          mastery_type: "Grammar",
        },
      ],
      mastery_updates: [],
    });
    const parsed = TutorAnalysis.safeParse(normalized);
    expect(parsed.success).toBe(true);
  });

  it("handles common wrappers, camelCase, and alias fields", () => {
    const normalized = normalizeTutorPayload({
      analysis: {
        isCorrect: "no",
        correctedSentence: "I went home.",
        naturalSentence: "I went home.",
        errors: [
          {
            category: "Grammar",
            spanOriginal: "go",
            spanCorrected: "went",
            reason: "Past time requires past tense.",
            severity: "Moderate",
            masteryKey: "grammar:past_tense",
            masteryLabel: "Simple past tense",
            masteryType: "Grammar",
          },
        ],
        masteryUpdates: [],
        expressionGap: null,
      },
    });
    const parsed = TutorAnalysis.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.is_correct).toBe(false);
      expect(parsed.data.issues[0].span_original).toBe("go");
    }
  });

  it("handles Chinese and mixed enum labels", () => {
    const normalized = normalizeTutorPayload({
      is_correct: false,
      corrected: "Do you have any other flavor options?",
      natural: "Do you have any other flavors available?",
      issues: [
        {
          category: "grammar:article_usage／代词",
          span_original: "another",
          span_corrected: "any other",
          explanation: '"another" is used with singular countable nouns.',
          severity: "中等",
          mastery_key: "grammar:article_usage",
          mastery_label: "Usage of articles a/an/the",
          mastery_type: "语法",
        },
      ],
      mastery_updates: [],
      expression_gap: null,
    });
    const parsed = TutorAnalysis.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.issues[0]).toMatchObject({
        category: "grammar",
        severity: "moderate",
        mastery_type: "grammar",
      });
    }
  });
});

describe("parseLLMJson", () => {
  it("errors on empty string", () => {
    expect(parseLLMJson("  ").ok).toBe(false);
  });

  it("gives a readable error hint for reasoning text", () => {
    const bad =
      "-> Type: `collocation`, Label: `介词搭配` (Signal: `introduced`)";
    const result = parseLLMJson(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("reasoning");
  });

  it("tolerates trailing commas in objects and arrays", () => {
    const result = parseLLMJson('{"a":[1,2,],"b":true,}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: [1, 2], b: true });
  });
});
