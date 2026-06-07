import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { analyze, type TutorContext } from "./tutor";

const ctx: TutorContext = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
  experiencePreferences: "",
  ignoreCapitalizationIssues: false,
  ignorePunctuationIssues: false,
  weakList: [],
  history: "",
  userInput: "I go home yesterday.",
};

function stubProvider(
  generate: (opts: GenerateOptions, call: number) => string,
): ModelProvider {
  let calls = 0;
  return {
    async generate(opts) {
      calls += 1;
      return generate(opts, calls);
    },
    async stream() {
      throw new Error("not used");
    },
  };
}

const validAnalysis = JSON.stringify({
  is_correct: false,
  corrected: "I went home yesterday.",
  natural: "I went home yesterday.",
  issues: [
    {
      category: "grammar",
      span_original: "go",
      span_corrected: "went",
      explanation:
        "'yesterday' implies past tense; use the past form of the verb.",
      severity: "moderate",
      mastery_key: "grammar:past_tense",
      mastery_label: "Simple past tense",
      mastery_type: "grammar",
    },
  ],
  mastery_updates: [],
  expression_gap: null,
});

describe("analyze", () => {
  it("on structured validation failure, tries JSON repair first and still returns analysis on success", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts, call) => {
      calls.push(opts);
      return call === 1 ? '{"is_correct":"maybe"}' : validAnalysis;
    });

    const result = await analyze(provider, ctx);

    expect(result.analysis?.corrected).toBe("I went home yesterday.");
    expect(result.proseFeedback).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1].meta?.label).toBe("tutor_repair");
    expect(calls[1].jsonSchema?.name).toBe("TutorAnalysis");
    expect(calls[1].jsonObject).toBeUndefined();
  });

  it("falls back to plain-text correction only when JSON repair also fails", async () => {
    const provider = stubProvider((_opts, call) => {
      if (call <= 2) return '{"is_correct":"maybe"}';
      return "【总评】有误\n\n【改正句】I went home yesterday.";
    });

    const result = await analyze(provider, ctx);

    expect(result.analysis).toBeNull();
    expect(result.proseFeedback).toContain("【总评】");
    expect(result.error).toContain("Structured correction degraded");
    expect(result.error).toContain("initial json_schema");
    expect(result.error).toContain("repair json_schema");
  });

  it("includes experience preferences in the structured tutor prompt", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return validAnalysis;
    });

    await analyze(provider, {
      ...ctx,
      experiencePreferences:
        "- Target-language variety: Australian English.\n- Correction preference: do not flag punctuation-only differences as mistakes.",
    });

    const system = calls[0].messages[0]?.content;
    expect(system).toContain("Australian English");
    expect(system).toContain("punctuation-only differences");
  });

  it("includes recent mastery key hints in the structured tutor prompt", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return validAnalysis;
    });

    await analyze(provider, {
      ...ctx,
      keyHints: [
        {
          key: "grammar:past_tense",
          label: "Simple past tense",
          type: "grammar",
          status: "learning",
        },
      ],
    });

    const system = calls[0].messages[0]?.content;
    expect(system).toContain("RECENT MASTERY KEY HINTS");
    expect(system).toContain("grammar:past_tense");
  });

  it("Chinese/mixed enums from the LLM do not cause real corrections to fall back to plain text", async () => {
    const provider = stubProvider(() =>
      JSON.stringify({
        is_correct: false,
        corrected: "Do you have any other flavor options?",
        natural: "Do you have any other flavors available?",
        issues: [
          {
            category: "grammar:article_usage／代词",
            span_original: "another",
            span_corrected: "any other",
            explanation:
              '"another" 用于单数可数名词，"flavor options" 是复数，应用 "any other"。',
            severity: "中等",
            mastery_key: "grammar:article_usage",
            mastery_label: "冠词 a/an/the 的用法",
            mastery_type: "语法",
          },
        ],
        mastery_updates: [],
        expression_gap: null,
      }),
    );

    const result = await analyze(provider, {
      ...ctx,
      userInput: "Do you have another flavor options?",
      weakList: [
        {
          label: "冠词 a/an/the 的用法",
          key: "grammar:article_usage",
          type: "grammar",
          status: "struggling",
        },
      ],
    });

    expect(result.proseFeedback).toBeUndefined();
    expect(result.analysis?.corrected).toBe(
      "Do you have any other flavor options?",
    );
    expect(result.analysis?.issues[0]).toMatchObject({
      category: "grammar",
      severity: "moderate",
      mastery_type: "grammar",
    });
  });

  it("code-side filtering strips ignored capitalization and punctuation-only issues", async () => {
    const punctuationAndCaseOnly = JSON.stringify({
      is_correct: false,
      corrected: "I'm happy.",
      natural: "I'm happy.",
      issues: [
        {
          category: "spelling",
          span_original: "im",
          span_corrected: "I'm",
          explanation: "Needs capitalization and apostrophe.",
          severity: "minor",
          mastery_key: "spelling:capitalization_contractions",
          mastery_label: "Capitalization and apostrophe",
          mastery_type: "error_pattern",
        },
        {
          category: "punctuation",
          span_original: "happy",
          span_corrected: "happy.",
          explanation: "Sentence needs a final punctuation mark.",
          severity: "minor",
          mastery_key: "punctuation:sentence_final_period",
          mastery_label: "Sentence-final punctuation",
          mastery_type: "error_pattern",
        },
      ],
      mastery_updates: [],
      expression_gap: null,
    });
    const provider = stubProvider(() => punctuationAndCaseOnly);

    const result = await analyze(provider, {
      ...ctx,
      ignoreCapitalizationIssues: true,
      ignorePunctuationIssues: true,
    });

    expect(result.analysis?.issues).toEqual([]);
    expect(result.analysis?.is_correct).toBe(true);
  });
});
