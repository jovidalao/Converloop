import { describe, expect, it } from "vitest";
import type { Issue } from "../agents/schema";
import { buildDiffSegments } from "./InlineCorrection";

function issue(span_original: string, span_corrected: string): Issue {
  return {
    category: "grammar",
    span_original,
    span_corrected,
    explanation: "",
    severity: "moderate",
    mastery_key: "grammar:there_be",
    mastery_label: "there be 句型",
    mastery_type: "grammar",
  };
}

describe("buildDiffSegments", () => {
  // 真实 bug:span "is" 之前会命中 "th[is]" 内部,把 this 的 is 划掉。
  it("短 span 按整词匹配,不命中更大单词内部", () => {
    const original = "Yeah, this seems like a good idea. is any tips for that?";
    const segments = buildDiffSegments(original, [issue("is", "Are there")]);
    const change = segments.find((s) => s.kind === "change");
    expect(change).toBeTruthy();
    // 划掉的必须是独立的 "is",且其左边是 "idea. " 而非 "th"。
    const beforeChange = segments
      .slice(0, segments.indexOf(change!))
      .map((s) => (s.kind === "same" ? s.text : ""))
      .join("");
    expect(beforeChange.endsWith("this seems like a good idea. ")).toBe(true);
    expect(beforeChange).toContain("this"); // "this" 完整保留在改动之前
  });

  it("整词 span 正常定位", () => {
    const segments = buildDiffSegments("I has a cat", [issue("has", "have")]);
    expect(segments).toContainEqual({
      kind: "change",
      original: "has",
      corrected: "have",
    });
  });
});
