import { describe, it, expect } from "vitest";
import { extractJsonText, parseLLMJson, normalizeTutorPayload } from "./parse-llm-json";
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
});

describe("parseLLMJson", () => {
  it("空字符串报错", () => {
    expect(parseLLMJson("  ").ok).toBe(false);
  });
});
