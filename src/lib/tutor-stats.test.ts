import { describe, expect, it } from "vitest";
import { degradedRate, getTutorStats, recordTutorOutcome } from "./tutor-stats";

describe("degradedRate", () => {
  it("empty stats → 0", () => {
    expect(degradedRate({ structured: 0, prose: 0, failed: 0 })).toBe(0);
  });

  it("prose + failed ratio", () => {
    expect(degradedRate({ structured: 6, prose: 2, failed: 2 })).toBeCloseTo(
      0.4,
    );
  });
});

describe("recordTutorOutcome", () => {
  it("increments in-process counters", () => {
    const before = { ...getTutorStats() };
    recordTutorOutcome("structured");
    recordTutorOutcome("prose");
    recordTutorOutcome("failed");
    const after = getTutorStats();
    expect(after.structured).toBe(before.structured + 1);
    expect(after.prose).toBe(before.prose + 1);
    expect(after.failed).toBe(before.failed + 1);
  });
});
