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
    mastery_label: "there be construction",
    mastery_type: "grammar",
  };
}

describe("buildDiffSegments", () => {
  // Real bug: span "is" would match inside "th[is]", striking out the "is" within "this".
  it("short span matches whole word, not inside a larger word", () => {
    const original = "Yeah, this seems like a good idea. is any tips for that?";
    const segments = buildDiffSegments(original, [issue("is", "Are there")]);
    const change = segments.find((s) => s.kind === "change");
    expect(change).toBeTruthy();
    // The struck-out segment must be the standalone "is", with "idea. " to its left, not "th".
    const beforeChange = segments
      .slice(0, segments.indexOf(change!))
      .map((s) => (s.kind === "same" ? s.text : ""))
      .join("");
    expect(beforeChange.endsWith("this seems like a good idea. ")).toBe(true);
    expect(beforeChange).toContain("this"); // "this" is fully preserved before the change segment
  });

  it("whole-word span is located correctly", () => {
    const segments = buildDiffSegments("I has a cat", [issue("has", "have")]);
    expect(segments).toContainEqual({
      kind: "change",
      original: "has",
      corrected: "have",
    });
  });
});
