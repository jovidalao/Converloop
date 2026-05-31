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
  it("证据不足 → hasEvidence=false、无提示", () => {
    const r = computeProficiency({ ...base, sampleTurns: 2 });
    expect(r.hasEvidence).toBe(false);
    expect(r.calibrationHint).toBe("");
  });

  it("长句、少错、少回退 → consolidating", () => {
    const r = computeProficiency({
      ...base,
      avgInputWords: 15,
      errorsPer100Words: 5,
      gapRate: 0.05,
    });
    expect(r.productionBand).toBe("consolidating");
  });

  it("短句或高回退 → emerging", () => {
    expect(
      computeProficiency({ ...base, avgInputWords: 4 }).productionBand,
    ).toBe("emerging");
    expect(computeProficiency({ ...base, gapRate: 0.4 }).productionBand).toBe(
      "emerging",
    );
  });

  it("中间情形 → developing", () => {
    expect(computeProficiency(base).productionBand).toBe("developing");
  });

  it("理解吃力度按 assistRate 分档", () => {
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

  it("有证据时给出非空校准提示", () => {
    expect(computeProficiency(base).calibrationHint.length).toBeGreaterThan(0);
  });
});
