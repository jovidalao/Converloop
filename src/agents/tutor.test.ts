import { describe, expect, it } from "vitest";
import type {
  FinishReason,
  GenerateOptions,
  ModelProvider,
} from "../providers/types";
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

// The tutor sends several system blocks (stable rules / preferences / per-turn data);
// join them when an assertion doesn't care which block carries the text.
function joinSystem(opts: GenerateOptions): string {
  return opts.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
}

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
  it("keeps correct signals for tracked keys and drops invented ones", async () => {
    const withCorrects = JSON.stringify({
      is_correct: true,
      corrected: "I went home yesterday.",
      natural: "I went home yesterday.",
      issues: [],
      mastery_updates: [
        {
          key: "grammar:past_tense",
          label: "Simple past tense",
          type: "grammar",
          signal: "correct",
        },
        {
          key: "vocab:fancy_word",
          label: "Fancy word",
          type: "vocab",
          signal: "correct",
        },
        {
          key: "vocab:new_phrase",
          label: "New phrase",
          type: "vocab",
          signal: "introduced",
        },
      ],
      expression_gap: null,
    });
    const provider = stubProvider(() => withCorrects);

    const result = await analyze(provider, {
      ...ctx,
      weakList: [
        {
          key: "grammar:past_tense",
          label: "Simple past tense",
          type: "grammar",
          status: "learning",
        },
      ],
    });

    const updates = result.analysis?.mastery_updates ?? [];
    // Tracked correct kept; untracked correct dropped; introduced may create new keys.
    expect(updates.map((u) => `${u.signal}:${u.key}`)).toEqual([
      "correct:grammar:past_tense",
      "introduced:vocab:new_phrase",
    ]);
  });

  it("passes a highlight through on a fully correct turn", async () => {
    const provider = stubProvider(() =>
      JSON.stringify({
        is_correct: true,
        corrected: "I ended up taking the late train.",
        natural: "I ended up taking the late train.",
        issues: [],
        mastery_updates: [],
        expression_gap: null,
        highlight: "“ended up taking” 用得很地道——比 “finally took” 更口语。",
      }),
    );

    const result = await analyze(provider, ctx);

    expect(result.analysis?.is_correct).toBe(true);
    expect(result.analysis?.highlight).toContain("ended up taking");
  });

  it("drops a highlight that rides on a turn with issues", async () => {
    const withMisplacedPraise = JSON.parse(validAnalysis) as Record<
      string,
      unknown
    >;
    withMisplacedPraise.highlight = "Great sentence!";
    const provider = stubProvider(() => JSON.stringify(withMisplacedPraise));

    const result = await analyze(provider, ctx);

    expect(result.analysis?.issues).toHaveLength(1);
    expect(result.analysis?.highlight ?? null).toBeNull();
  });

  it('normalizes a placeholder highlight ("none") to null', async () => {
    const provider = stubProvider(() =>
      JSON.stringify({
        is_correct: true,
        corrected: "I went home yesterday.",
        natural: "I went home yesterday.",
        issues: [],
        mastery_updates: [],
        expression_gap: null,
        highlight: "none",
      }),
    );

    const result = await analyze(provider, ctx);

    expect(result.analysis?.highlight ?? null).toBeNull();
  });

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

  it("recovers structured analysis via plain-text JSON when response_format returns empty", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      // Endpoint emits empty content whenever response_format is set, but answers in plain text.
      if (opts.jsonSchema || opts.jsonObject) return "";
      return validAnalysis;
    });

    const result = await analyze(provider, ctx);

    expect(result.analysis?.corrected).toBe("I went home yesterday.");
    expect(result.proseFeedback).toBeUndefined();
    // tier 1 json_schema (empty) → tier 2 json_object (empty) → tier 3 plain text (ok)
    expect(calls).toHaveLength(3);
    expect(calls[0].jsonSchema?.name).toBe("TutorAnalysis");
    expect(calls[1].jsonObject).toBe(true);
    expect(calls[2].jsonSchema).toBeUndefined();
    expect(calls[2].jsonObject).toBeUndefined();
  });

  it("retries with a larger token budget when the model truncates on reasoning (finish_reason length)", async () => {
    const length: FinishReason = {
      kind: "length",
      raw: "length",
      provider: "openai",
    };
    const calls: GenerateOptions[] = [];
    const provider: ModelProvider = {
      async generate(opts) {
        calls.push(opts);
        if (calls.length === 1) {
          opts.onFinish?.(length); // reasoning ate the budget before any answer
          return "";
        }
        return validAnalysis;
      },
      async stream() {
        throw new Error("not used");
      },
    };

    const result = await analyze(provider, ctx);

    expect(result.analysis?.corrected).toBe("I went home yesterday.");
    expect(calls).toHaveLength(2);
    expect(calls[0].maxTokens).toBe(4096);
    expect(calls[1].maxTokens).toBe(8192);
    expect(calls[1].jsonSchema?.name).toBe("TutorAnalysis");
  });

  it("surfaces the provider finish reason in the failure diagnostic", async () => {
    const length: FinishReason = {
      kind: "length",
      raw: "length",
      provider: "openai",
    };
    const provider: ModelProvider = {
      async generate(opts) {
        opts.onFinish?.(length);
        return ""; // never produces content, even after the budget retry
      },
      async stream() {
        throw new Error("not used");
      },
    };

    const result = await analyze(provider, ctx);

    expect(result.analysis).toBeNull();
    // The dev details live in the diagnostic; the user-facing error stays a short line.
    expect(result.diagnostic).toContain("finish reason: length");
    expect(result.error).not.toContain("finish reason");
  });

  it("falls back to plain-text correction only when JSON repair also fails", async () => {
    const provider = stubProvider((_opts, call) => {
      if (call <= 2) return '{"is_correct":"maybe"}';
      return "【总评】有误\n\n【改正句】I went home yesterday.";
    });

    const result = await analyze(provider, ctx);

    expect(result.analysis).toBeNull();
    expect(result.proseFeedback).toContain("【总评】");
    // Degradation details go to the diagnostic only; no error line rides along with prose.
    expect(result.error).toBeUndefined();
    expect(result.diagnostic).toContain("Structured correction degraded");
    expect(result.diagnostic).toContain("initial json_schema");
    expect(result.diagnostic).toContain("repair json_schema");
  });

  it("sends the shallow core schema (no expression_gap) for pure target-language input", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return validAnalysis;
    });

    await analyze(provider, ctx); // userInput "I go home yesterday." — no native script, no gap cue

    const props = (calls[0].jsonSchema?.schema as any).properties;
    expect(props).toHaveProperty("issues");
    expect(props).not.toHaveProperty("expression_gap");
    const system = calls[0].messages[0]?.content as string;
    expect(system).not.toContain("EXPRESSION GAP");
  });

  it("sends the full schema with expression_gap when the input falls back to the native language", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return validAnalysis;
    });

    await analyze(provider, {
      ...ctx,
      userInput: "我想说 I go home 但是不会说",
    });

    const props = (calls[0].jsonSchema?.schema as any).properties;
    expect(props).toHaveProperty("expression_gap");
    const system = calls[0].messages[0]?.content as string;
    expect(system).toContain("EXPRESSION GAP");
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

    const system = joinSystem(calls[0]);
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

    const system = joinSystem(calls[0]);
    expect(system).toContain("RECENT MASTERY KEY HINTS");
    expect(system).toContain("grammar:past_tense");
  });

  it("repairs structured output when corrected changes but issues are empty", async () => {
    const calls: GenerateOptions[] = [];
    const incomplete = JSON.stringify({
      is_correct: false,
      corrected: "I'd pick Silicon Valley.",
      natural: "I'd pick Silicon Valley.",
      issues: [],
      mastery_updates: [
        {
          key: "grammar:conditionals",
          label: "Conditionals",
          type: "grammar",
          signal: "introduced",
        },
      ],
      expression_gap: null,
    });
    const repaired = JSON.stringify({
      is_correct: false,
      corrected: "I'd pick Silicon Valley.",
      natural: "I'd pick Silicon Valley.",
      issues: [
        {
          category: "grammar",
          span_original: "I’ll",
          span_corrected: "I'd",
          explanation: "这是回答假设问题，用 would 比 will 更自然、准确。",
          severity: "moderate",
          mastery_key: "grammar:would_for_hypotheticals",
          mastery_label: "用 would 回答假设问题",
          mastery_type: "grammar",
        },
      ],
      mastery_updates: [],
      expression_gap: null,
    });
    const provider = stubProvider((opts, call) => {
      calls.push(opts);
      return call === 1 ? incomplete : repaired;
    });

    const result = await analyze(provider, {
      ...ctx,
      userInput: "I’ll pick Silicon Valley.",
    });

    expect(result.analysis?.issues).toHaveLength(1);
    expect(result.analysis?.issues[0]).toMatchObject({
      span_original: "I’ll",
      span_corrected: "I'd",
    });
    expect(result.analysis?.mastery_updates).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[1].meta?.label).toBe("tutor_repair");
  });

  it("drops a spurious expression_gap for pure target-language input", async () => {
    const provider = stubProvider(() =>
      JSON.stringify({
        is_correct: false,
        corrected: "I'd like to enjoy the tech industry.",
        natural:
          "I'd love to enjoy both — being part of the tech industry and soaking up that creative vibe.",
        issues: [
          {
            category: "grammar",
            span_original: "Tech industry",
            span_corrected: "the tech industry",
            explanation: "需要加定冠词 the。",
            severity: "moderate",
            mastery_key: "grammar:article_usage",
            mastery_label: "冠词 a/an/the 的用法",
            mastery_type: "grammar",
          },
        ],
        mastery_updates: [],
        expression_gap: {
          mastery_key: "gap:expressing_preference_in_context",
          mastery_label: "在对话中表达偏好",
          original: "I'd like to enjoy Tech industry",
          target_expression:
            "I'd love to enjoy both — being part of the tech industry and soaking up that creative vibe.",
          explanation: "This was incorrectly classified as a gap.",
          key_items: [],
        },
      }),
    );

    const result = await analyze(provider, {
      ...ctx,
      userInput: "I'd like to enjoy Tech industry",
    });

    expect(result.analysis?.expression_gap).toBeNull();
    expect(result.analysis?.issues).toHaveLength(1);
    expect(result.analysis?.natural).toContain("tech industry");
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
