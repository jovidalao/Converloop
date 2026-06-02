import { describe, expect, it } from "vitest";
import { parseTurnFeedback, serializeTurnFeedback } from "./turns";

describe("turn feedback serialization", () => {
  it("round-trips prose fallback", () => {
    const json = serializeTurnFeedback(
      null,
      "【总评】有误\n【改正句】Hi",
      "schema: issues.0.category invalid",
    );
    expect(json).toBeTruthy();
    const parsed = parseTurnFeedback(json);
    expect(parsed.analysis).toBeNull();
    expect(parsed.prose).toContain("【总评】");
    expect(parsed.diagnostic).toContain("issues.0.category");
  });

  it("structured analysis takes precedence over prose arg", () => {
    const json = serializeTurnFeedback(
      {
        is_correct: true,
        corrected: "ok",
        natural: "ok",
        issues: [],
        mastery_updates: [],
        expression_gap: null,
      },
      "ignored",
    );
    expect(parseTurnFeedback(json).prose).toBeNull();
    expect(parseTurnFeedback(json).diagnostic).toBeNull();
    expect(parseTurnFeedback(json).analysis?.is_correct).toBe(true);
  });
});
