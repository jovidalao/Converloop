import { describe, expect, it } from "vitest";
import { computeProficiency, type ProficiencyMetrics } from "./proficiency";

const base: ProficiencyMetrics = {
  sampleTurns: 10,
  avgInputWords: 9,
  errorsPer100Words: 12,
  gapRate: 0.15,
  assistRate: 0.2,
  knownCount: 3,
  strugglingCount: 4,
};

describe("computeProficiency", () => {
  it("insufficient evidence → hasEvidence=false, empty calibration hint", () => {
    const r = computeProficiency({ ...base, sampleTurns: 2 });
    expect(r.hasEvidence).toBe(false);
    expect(r.calibrationHint).toBe("");
  });

  it("long sentences, few errors, low fallback → consolidating", () => {
    const r = computeProficiency({
      ...base,
      avgInputWords: 15,
      errorsPer100Words: 5,
      gapRate: 0.05,
    });
    expect(r.productionBand).toBe("consolidating");
  });

  it("short sentences or high fallback → emerging", () => {
    expect(
      computeProficiency({ ...base, avgInputWords: 4 }).productionBand,
    ).toBe("emerging");
    expect(computeProficiency({ ...base, gapRate: 0.4 }).productionBand).toBe(
      "emerging",
    );
  });

  it("intermediate case → developing", () => {
    expect(computeProficiency(base).productionBand).toBe("developing");
  });

  it("comprehension strain bands by assistRate", () => {
    expect(
      computeProficiency({ ...base, assistRate: 0.6 }).comprehensionStrain,
    ).toBe("high");
    expect(
      computeProficiency({ ...base, assistRate: 0.2 }).comprehensionStrain,
    ).toBe("moderate");
    expect(
      computeProficiency({ ...base, assistRate: 0.05 }).comprehensionStrain,
    ).toBe("low");
  });

  it("gives a non-empty calibration hint when there is evidence", () => {
    expect(computeProficiency(base).calibrationHint.length).toBeGreaterThan(0);
  });
});
