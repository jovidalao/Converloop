import { describe, expect, it } from "vitest";
import { estimatePromptTokens, estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it("empty string is 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("English counts at ~4 chars/token", () => {
    // 20 chars → ceil(20/4) = 5
    expect(estimateTokens("abcd ".repeat(4))).toBe(5);
  });

  it("CJK counts at ~1 token/character", () => {
    expect(estimateTokens("你好世界")).toBe(4);
  });

  it("CJK and Latin mixed text are counted separately", () => {
    // 4 CJK chars + 8 non-CJK chars → 4 + ceil(8/4) = 6
    expect(estimateTokens("你好世界abcd efg")).toBe(4 + Math.ceil(8 / 4));
  });
});

describe("estimatePromptTokens", () => {
  it("each message has a fixed overhead that accumulates", () => {
    // "你好" (2 tokens) + 4 overhead, two messages → (2+4)*2 = 12
    expect(estimatePromptTokens(["你好", "你好"])).toBe(12);
  });
});
