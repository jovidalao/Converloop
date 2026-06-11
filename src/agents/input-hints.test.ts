import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { generateInputHints } from "./input-hints";

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

describe("generateInputHints", () => {
  it("uses a plain-text hint when the provider does not return a JSON array", async () => {
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

  it("cleans truncated JSON-array syntax before showing a fallback hint", async () => {
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

  it("drops a cue-only hint with no opener after the arrow", async () => {
    const calls: GenerateOptions[] = [];

    const hints = await generateInputHints(
      stubProvider("分享你经常做的那道菜，并用强调句简单介绍它 →", calls),
      ctx,
    );

    expect(hints).toEqual([]);
  });
});
