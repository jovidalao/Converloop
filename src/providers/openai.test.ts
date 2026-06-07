import { describe, expect, it } from "vitest";
import { consumeSseLines } from "./openai";

describe("openai stream usage", () => {
  it("reads prompt_tokens from the trailing usage chunk", () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":10}}',
      "data: [DONE]",
    ];
    const out: string[] = [];
    const r = consumeSseLines(lines, (d) => out.push(d));
    expect(out.join("")).toBe("Hi");
    expect(r.usage).toEqual({ inputTokens: 321, outputTokens: 10 });
  });

  it("leaves usage undefined when the endpoint omits a usage chunk", () => {
    const r = consumeSseLines(
      ['data: {"choices":[{"delta":{"content":"x"}}]}'],
      () => {},
    );
    expect(r.usage).toBeUndefined();
  });
});
