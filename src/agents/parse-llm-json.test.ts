import { describe, expect, it } from "vitest";
import {
  extractJsonText,
  normalizeTutorPayload,
  parseLLMJson,
  parseStringArrayLoose,
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

describe("parseStringArrayLoose", () => {
  it("parses a well-formed array", () => {
    expect(parseStringArrayLoose('["a", "b"]')).toEqual(["a", "b"]);
  });

  it("strips a complete ```json fence", () => {
    expect(parseStringArrayLoose('```json\n["a", "b"]\n```')).toEqual([
      "a",
      "b",
    ]);
  });

  it("salvages elements when the closing fence is missing", () => {
    expect(parseStringArrayLoose('```json\n["a", "b"]')).toEqual(["a", "b"]);
  });

  it("salvages complete elements and drops a truncated trailing one", () => {
    expect(
      parseStringArrayLoose('["done one", "done two", "cut off here'),
    ).toEqual(["done one", "done two"]);
  });

  it("decodes escapes via JSON, including escaped quotes", () => {
    expect(parseStringArrayLoose('["cue → \\"quoted opener\\""]')).toEqual([
      'cue → "quoted opener"',
    ]);
  });

  it("returns nothing for the truncated-fence case from the bug report", () => {
    // The model emitted a fenced array cut off mid-element (no element ever closed).
    const raw =
      '```json\n[\n"回答偏好慢歌并解释原因 → \\"I definitely prefer slower, relaxing music';
    expect(parseStringArrayLoose(raw)).toEqual([]);
  });

  it("returns [] when there is no array at all", () => {
    expect(parseStringArrayLoose("Sorry, I can't help with that.")).toEqual([]);
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

  it('coerces a placeholder "null" string for expression_gap to null', () => {
    // Some models emit the literal string "null" instead of JSON null; without
    // coercion Zod rejects the whole turn (Expected object, received string).
    const normalized = normalizeTutorPayload({
      is_correct: false,
      corrected: "Hi, I want to practice how to convince people.",
      natural: "Hi, I'd like to practice how to convince people.",
      issues: [],
      mastery_updates: [],
      expression_gap: "null",
    });
    const parsed = TutorAnalysis.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.expression_gap).toBeNull();
  });

  it("parses a double-encoded JSON-string expression_gap into an object", () => {
    // Some models stringify the whole gap object instead of nesting it; without
    // parsing it back Zod rejects the turn (expression_gap: Expected object,
    // received string) and the correction degrades to plain text.
    const gap = {
      mastery_key: "gap:expressing_agreement",
      mastery_label: "表达赞同/附和对方",
      original: "I think refund",
      target_expression: "I think so too! It's a must-listen.",
      template: "I think so too! It's ___.",
      explanation: '附和对方时英文固定说法是 "I think so too"。',
      key_items: [
        {
          text: "I think so too",
          gloss: "我也这么认为（固定附和表达）",
          mastery_key: "collocation:expressing_agreement",
          mastery_label: "附和对方的固定说法",
          mastery_type: "collocation",
        },
      ],
      usage_note: "",
    };
    const normalized = normalizeTutorPayload({
      is_correct: false,
      corrected: "I think so too.",
      natural: "I think so too — it's such a great song!",
      issues: [],
      mastery_updates: [],
      expression_gap: JSON.stringify(gap),
    });
    const parsed = TutorAnalysis.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.expression_gap).toMatchObject({
        mastery_key: "gap:expressing_agreement",
        original: "I think refund",
      });
      expect(parsed.data.expression_gap?.key_items[0].mastery_type).toBe(
        "collocation",
      );
    }
  });

  it("leaves a non-JSON expression_gap string untouched (degrades as before)", () => {
    const normalized = normalizeTutorPayload({
      is_correct: false,
      corrected: "Hi.",
      natural: "Hi.",
      issues: [],
      mastery_updates: [],
      expression_gap: "just some prose, not JSON",
    }) as { expression_gap: unknown };
    expect(normalized.expression_gap).toBe("just some prose, not JSON");
    expect(TutorAnalysis.safeParse(normalized).success).toBe(false);
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
