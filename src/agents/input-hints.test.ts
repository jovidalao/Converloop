import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { generateInputHints, splitHintParts } from "./input-hints";

const ctx = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
  recentHistory:
    "Partner: I finally finished that presentation.\nUser: Nice!\nPartner: It was more stressful than I expected.",
};

function stubProvider(raw: string, calls: GenerateOptions[]): ModelProvider {
  return {
    async generate(opts) {
      calls.push(opts);
      return raw;
    },
    async stream() {
      throw new Error("not used");
    },
  };
}

// Returns each element of raws in order, repeating the last one once exhausted.
function sequenceProvider(
  raws: string[],
  calls: GenerateOptions[],
): ModelProvider {
  let i = 0;
  return {
    async generate(opts) {
      calls.push(opts);
      const raw = raws[Math.min(i, raws.length - 1)];
      i++;
      return raw;
    },
    async stream() {
      throw new Error("not used");
    },
  };
}

describe("splitHintParts", () => {
  it("splits a cue → opener line", () => {
    expect(
      splitHintParts("追问压力来源 → What made it feel so stressful?"),
    ).toEqual({
      cue: "追问压力来源",
      opener: "What made it feel so stressful?",
    });
  });

  it("accepts the ASCII arrow", () => {
    expect(splitHintParts("表达共情 -> That sounds intense.")).toEqual({
      cue: "表达共情",
      opener: "That sounds intense.",
    });
  });

  it("splits at the first arrow and keeps later ones in the opener", () => {
    expect(splitHintParts("解释流程 → First A → then B")).toEqual({
      cue: "解释流程",
      opener: "First A → then B",
    });
  });

  it("treats an arrowless line as opener-only", () => {
    expect(splitHintParts("How did the Q&A part go?")).toEqual({
      cue: null,
      opener: "How did the Q&A part go?",
    });
  });
});

describe("generateInputHints", () => {
  it("returns a plain-text cue → opener line as-is", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider(
        '追问压力最大的部分 -> "What ended up being the most stressful part?"',
        calls,
      ),
      ctx,
    );

    expect(hints).toEqual([
      '追问压力最大的部分 -> "What ended up being the most stressful part?"',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.meta?.label).toBe("input-hints");
  });

  it("accepts a single-string JSON response", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider(
        '"表达共情并追问 -> That sounds intense — what made it feel so stressful?"',
        calls,
      ),
      ctx,
    );

    expect(hints).toEqual([
      "表达共情并追问 -> That sounds intense — what made it feel so stressful?",
    ]);
  });

  it("salvages the hint from truncated JSON-array syntax", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider(
        '["回答你最喜欢的菜并反问对方 → \\"My absolute favorite is ___,',
        calls,
      ),
      ctx,
    );

    expect(hints).toEqual([
      '回答你最喜欢的菜并反问对方 → "My absolute favorite is ___,',
    ]);
  });

  it("takes the first element of a stray JSON array response", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider(
        '```json\n["追问演讲细节 → How did the Q&A part go?", "分享经历 → I had a similar week."]\n```',
        calls,
      ),
      ctx,
    );

    expect(hints).toEqual(["追问演讲细节 → How did the Q&A part go?"]);
  });

  it("picks the cue → opener line out of preamble lines", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider(
        "Here is the best hint for this moment:\n表达共情并追问 → That sounds intense — what was the hardest part?",
        calls,
      ),
      ctx,
    );

    expect(hints).toEqual([
      "表达共情并追问 → That sounds intense — what was the hardest part?",
    ]);
  });

  it("truncates an over-length hint instead of dropping it", async () => {
    const calls: GenerateOptions[] = [];
    const longOpener = `表达共情并追问 → ${"That sounds intense and exhausting. ".repeat(10)}`;

    const hints = await generateInputHints(
      stubProvider(longOpener, calls),
      ctx,
    );

    expect(hints).toHaveLength(1);
    expect(hints[0].length).toBeLessThanOrEqual(220);
    expect(hints[0].endsWith("…")).toBe(true);
  });

  it("retries once when the first response is empty", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      sequenceProvider(
        ["", "追问压力来源 → What made it feel so stressful?"],
        calls,
      ),
      ctx,
    );

    expect(calls).toHaveLength(2);
    expect(hints).toEqual(["追问压力来源 → What made it feel so stressful?"]);
  });

  it("returns no hint when both attempts produce a cue with no opener", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider("分享你经常做的那道菜，并用强调句简单介绍它 →", calls),
      ctx,
    );

    expect(calls).toHaveLength(2);
    expect(hints).toEqual([]);
  });
});
