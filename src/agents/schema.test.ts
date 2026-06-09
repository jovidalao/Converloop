import { describe, expect, it } from "vitest";
import {
  MASTERY_TYPE_VALUES,
  MASTERY_UPDATE_SIGNAL_VALUES,
} from "../db/mastery-values";
import {
  MasteryType,
  MasteryUpdate,
  TutorAnalysis,
  tutorJsonSchema,
} from "./schema";

// Simulated LLM structured output for a real erroneous sentence:
// "I have a apple and I go to school yesterday."
const sampleAnalysis = {
  is_correct: false,
  corrected: "I have an apple and I went to school yesterday.",
  natural: "I had an apple and went to school yesterday.",
  issues: [
    {
      category: "grammar",
      span_original: "a apple",
      span_corrected: "an apple",
      explanation: "Use 'an' before words starting with a vowel sound.",
      severity: "minor",
      mastery_key: "grammar:article_usage",
      mastery_label: "Articles a/an/the",
      mastery_type: "grammar",
    },
    {
      category: "grammar",
      span_original: "I go to school yesterday",
      span_corrected: "I went to school yesterday",
      explanation:
        "'yesterday' implies past tense; use the past form of the verb.",
      severity: "moderate",
      mastery_key: "grammar:past_tense",
      mastery_label: "Simple past tense",
      mastery_type: "grammar",
    },
  ],
  mastery_updates: [
    {
      key: "grammar:past_tense",
      label: "Simple past tense",
      type: "grammar",
      signal: "introduced",
    },
  ],
  expression_gap: null,
};

describe("TutorAnalysis schema", () => {
  it("reuses DB-layer mastery enums to prevent validation drift", () => {
    expect(MasteryType.options).toEqual([...MASTERY_TYPE_VALUES]);
    expect(MasteryUpdate.shape.signal.options).toEqual([
      ...MASTERY_UPDATE_SIGNAL_VALUES,
    ]);
  });

  it("passes Zod validation and issues have well-formed mastery_key", () => {
    const parsed = TutorAnalysis.safeParse(sampleAnalysis);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.issues).toHaveLength(2);
      for (const issue of parsed.data.issues) {
        expect(issue.mastery_key).toMatch(/^[a-z_]+:[a-z_]+$/);
      }
    }
  });

  it("rejects missing fields and invalid enums (fallback relies on this)", () => {
    expect(TutorAnalysis.safeParse({ is_correct: true }).success).toBe(false);
    expect(
      TutorAnalysis.safeParse({ ...sampleAnalysis, is_correct: "yes" }).success,
    ).toBe(false);
  });

  it("evidence is optional", () => {
    const r = TutorAnalysis.safeParse({
      ...sampleAnalysis,
      mastery_updates: [
        { key: "k:x", label: "x", type: "vocab", signal: "correct" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("expression_gap can include a reusable template", () => {
    const r = TutorAnalysis.safeParse({
      ...sampleAnalysis,
      issues: [],
      mastery_updates: [],
      expression_gap: {
        mastery_key: "gap:decline_request_politely",
        mastery_label: "Declining requests politely",
        original: "I want to decline this request politely",
        target_expression: "I'd rather not take this on right now.",
        template: "I'd rather not ___ right now.",
        explanation: "Use 'I'd rather not' to express a polite refusal.",
        key_items: [],
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("tutorJsonSchema", () => {
  it("produces a clean JSON schema (no $schema field, has properties)", () => {
    const { name, schema } = tutorJsonSchema();
    expect(name).toBe("TutorAnalysis");
    expect(schema.$schema).toBeUndefined();
    expect((schema as any).type).toBe("object");
    expect((schema as any).properties).toHaveProperty("issues");
    expect((schema as any).properties).toHaveProperty("mastery_updates");
    expect((schema as any).required).toContain("expression_gap");
  });

  it("omits expression_gap in the shallow core schema (includeGap=false)", () => {
    const { name, schema } = tutorJsonSchema(false);
    expect(name).toBe("TutorAnalysis");
    expect((schema as any).properties).toHaveProperty("issues");
    expect((schema as any).properties).not.toHaveProperty("expression_gap");
    expect((schema as any).required).not.toContain("expression_gap");
  });
});
