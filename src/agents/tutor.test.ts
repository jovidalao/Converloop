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
      explanation: "yesterday 表示过去,动词要用过去式。",
      severity: "moderate",
      mastery_key: "grammar:past_tense",
      mastery_label: "一般过去时",
      mastery_type: "grammar",
    },
  ],
  mastery_updates: [],
  expression_gap: null,
});

describe("analyze", () => {
  it("结构化校验失败后先尝试 JSON 修复,成功后仍返回 analysis", async () => {
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
    expect(calls[1].jsonObject).toBe(true);
  });

  it("JSON 修复也失败时才退回纯文本批改", async () => {
    const provider = stubProvider((_opts, call) => {
      if (call <= 2) return '{"is_correct":"maybe"}';
      return "【总评】有误\n\n【改正句】I went home yesterday.";
    });

    const result = await analyze(provider, ctx);

    expect(result.analysis).toBeNull();
    expect(result.proseFeedback).toContain("【总评】");
  });

  it("把体验偏好放进结构化导师 prompt", async () => {
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

  it("代码侧过滤被忽略的纯标点和大小写问题", async () => {
    const punctuationAndCaseOnly = JSON.stringify({
      is_correct: false,
      corrected: "I'm happy.",
      natural: "I'm happy.",
      issues: [
        {
          category: "spelling",
          span_original: "im",
          span_corrected: "I'm",
          explanation: "需要大写并加 apostrophe。",
          severity: "minor",
          mastery_key: "spelling:capitalization_contractions",
          mastery_label: "大小写和撇号",
          mastery_type: "error_pattern",
        },
        {
          category: "punctuation",
          span_original: "happy",
          span_corrected: "happy.",
          explanation: "句末需要标点。",
          severity: "minor",
          mastery_key: "punctuation:sentence_final_period",
          mastery_label: "句末标点",
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
