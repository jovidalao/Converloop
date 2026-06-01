import { describe, expect, it } from "vitest";
import {
  extractJsonText,
  isLikelyTutorJsonPayload,
  normalizeTutorPayload,
  parseLLMJson,
} from "./parse-llm-json";
import { TutorAnalysis } from "./schema";

describe("extractJsonText", () => {
  it("去掉 markdown 围栏", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("从混合文本里截取对象", () => {
    expect(extractJsonText('Here:\n{"a":1}\nDone')).toBe('{"a":1}');
  });
});

describe("normalizeTutorPayload", () => {
  it("修正枚举大小写", () => {
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

  it("兼容常见 wrapper、camelCase 和别名字段", () => {
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
            reason: "过去时间要用过去式。",
            severity: "Moderate",
            masteryKey: "grammar:past_tense",
            masteryLabel: "一般过去时",
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
});

describe("parseLLMJson", () => {
  it("空字符串报错", () => {
    expect(parseLLMJson("  ").ok).toBe(false);
  });

  it("推理文本给出可读提示", () => {
    const bad =
      "-> Type: `collocation`, Label: `介词搭配` (Signal: `introduced`)";
    const result = parseLLMJson(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("推理过程");
  });

  it("容忍对象和数组结尾的多余逗号", () => {
    const result = parseLLMJson('{"a":[1,2,],"b":true,}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: [1, 2], b: true });
  });
});

describe("isLikelyTutorJsonPayload", () => {
  it("接受合法 JSON 对象", () => {
    expect(isLikelyTutorJsonPayload('{"is_correct":true}')).toBe(true);
  });

  it("拒绝推理片段", () => {
    expect(isLikelyTutorJsonPayload("-> Type: `vocab`")).toBe(false);
  });
});
