import { describe, expect, it } from "vitest";
import { estimatePromptTokens, estimateTokens } from "./tokens";

describe("estimateTokens", () => {
  it("空串为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("英文按 ~4 字符/token", () => {
    // 20 字符 → ceil(20/4) = 5
    expect(estimateTokens("abcd ".repeat(4))).toBe(5);
  });

  it("CJK 按 ~1 token/字", () => {
    expect(estimateTokens("你好世界")).toBe(4);
  });

  it("中英混排分别计数", () => {
    // 4 个汉字 + 8 个非汉字字符 → 4 + ceil(8/4) = 6
    expect(estimateTokens("你好世界abcd efg")).toBe(4 + Math.ceil(8 / 4));
  });
});

describe("estimatePromptTokens", () => {
  it("每条消息含固定开销且累加", () => {
    // "你好"(2) + 4 开销,两条 → (2+4)*2 = 12
    expect(estimatePromptTokens(["你好", "你好"])).toBe(12);
  });
});
