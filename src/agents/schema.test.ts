import { describe, expect, it } from "vitest";
import { TutorAnalysis, tutorJsonSchema } from "./schema";

// 模拟 LLM 对一个真实错句的结构化输出:
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
      explanation: "元音音素开头的词前用 an。",
      severity: "minor",
      mastery_key: "grammar:article_usage",
      mastery_label: "冠词 a/an/the 的用法",
      mastery_type: "grammar",
    },
    {
      category: "grammar",
      span_original: "I go to school yesterday",
      span_corrected: "I went to school yesterday",
      explanation: "yesterday 表示过去,动词要用过去式。",
      severity: "moderate",
      mastery_key: "grammar:past_tense",
      mastery_label: "一般过去时",
      mastery_type: "grammar",
    },
  ],
  mastery_updates: [
    {
      key: "grammar:past_tense",
      label: "一般过去时",
      type: "grammar",
      signal: "introduced",
    },
  ],
  expression_gap: null,
};

describe("TutorAnalysis schema", () => {
  it("通过 Zod 校验,issues 的 mastery_key 合理", () => {
    const parsed = TutorAnalysis.safeParse(sampleAnalysis);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.issues).toHaveLength(2);
      for (const issue of parsed.data.issues) {
        expect(issue.mastery_key).toMatch(/^[a-z_]+:[a-z_]+$/);
      }
    }
  });

  it("拒绝缺字段/错枚举的脏数据(降级靠它)", () => {
    expect(TutorAnalysis.safeParse({ is_correct: true }).success).toBe(false);
    expect(
      TutorAnalysis.safeParse({ ...sampleAnalysis, is_correct: "yes" }).success,
    ).toBe(false);
  });

  it("evidence 可选", () => {
    const r = TutorAnalysis.safeParse({
      ...sampleAnalysis,
      mastery_updates: [
        { key: "k:x", label: "x", type: "vocab", signal: "correct" },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("tutorJsonSchema", () => {
  it("产出干净的 JSON schema(无 $schema,含 properties)", () => {
    const { name, schema } = tutorJsonSchema();
    expect(name).toBe("TutorAnalysis");
    expect(schema.$schema).toBeUndefined();
    expect((schema as any).type).toBe("object");
    expect((schema as any).properties).toHaveProperty("issues");
    expect((schema as any).properties).toHaveProperty("mastery_updates");
    expect((schema as any).required).toContain("expression_gap");
  });
});
