import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { analyze, type TutorContext } from "./tutor";

const ctx: TutorContext = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
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
});
