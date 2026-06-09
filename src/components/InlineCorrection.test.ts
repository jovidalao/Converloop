import { describe, expect, it } from "vitest";
import type { Issue } from "../agents/schema";
import {
  buildDiffSegments,
  buildWholeSentenceDiff,
  hasCorrectedSentenceChange,
} from "./InlineCorrection";

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

describe("buildWholeSentenceDiff", () => {
  // The main-page fallback when the tutor returns a corrected sentence but no
  // locatable issue spans — mirrors what the coach panel shows via corrected.
  it("diffs a single replaced word", () => {
    const segments = buildWholeSentenceDiff("I has a cat", "I have a cat");
    expect(segments).toContainEqual({
      kind: "change",
      original: "has",
      corrected: "have",
    });
  });

  it("captures an inserted word without losing sentence spacing", () => {
    const segments = buildWholeSentenceDiff("I a cat", "I have a cat");
    expect(segments).toContainEqual({
      kind: "change",
      original: "",
      corrected: "have",
    });
    // Reconstructing same + corrected text yields the corrected sentence (no
    // dropped or doubled spaces).
    const rebuilt = segments
      .map((s) => (s.kind === "same" ? s.text : s.corrected))
      .join("");
    expect(rebuilt).toBe("I have a cat");
  });

  it("captures a deleted word", () => {
    const segments = buildWholeSentenceDiff("I do have a cat", "I have a cat");
    expect(segments).toContainEqual({
      kind: "change",
      original: "do",
      corrected: "",
    });
  });

  it("has no change segment when the sentences match", () => {
    const segments = buildWholeSentenceDiff("I have a cat", "I have a cat");
    expect(segments.some((s) => s.kind === "change")).toBe(false);
  });
});

describe("hasCorrectedSentenceChange", () => {
  it("detects corrected-only tutor output so the action row does not show no-changes", () => {
    expect(
      hasCorrectedSentenceChange("I’ll pick Silicon Valley.", {
        is_correct: false,
        corrected: "I'd pick Silicon Valley.",
        natural: "I'd pick Silicon Valley.",
        issues: [],
        mastery_updates: [],
        expression_gap: null,
      }),
    ).toBe(true);
  });

  it("stays false when regular issue details are present", () => {
    expect(
      hasCorrectedSentenceChange("I has a cat", {
        is_correct: false,
        corrected: "I have a cat",
        natural: "I have a cat",
        issues: [issue("has", "have")],
        mastery_updates: [],
        expression_gap: null,
      }),
    ).toBe(false);
  });
});
