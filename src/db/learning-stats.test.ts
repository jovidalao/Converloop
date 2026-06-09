import { describe, expect, it } from "vitest";
import {
  computeStreaks,
  isCountablePracticeTurn,
  localDayNumber,
} from "./learning-stats";

describe("computeStreaks", () => {
  it("counts a current streak ending today", () => {
    expect(computeStreaks([10, 9, 8], 10)).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the streak alive when the last practice was yesterday", () => {
    expect(computeStreaks([9, 8], 10)).toEqual({ current: 2, longest: 2 });
  });

  it("breaks the current streak after a two-day gap", () => {
    expect(computeStreaks([8, 7], 10)).toEqual({ current: 0, longest: 2 });
  });

  it("tracks the longest run independently from the current one", () => {
    expect(computeStreaks([1, 2, 3, 4, 9, 10], 10)).toEqual({
      current: 2,
      longest: 4,
    });
  });

  it("ignores duplicate and unordered days", () => {
    expect(computeStreaks([10, 10, 9, 8], 10)).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it("handles no activity", () => {
    expect(computeStreaks([], 10)).toEqual({ current: 0, longest: 0 });
  });
});

describe("localDayNumber", () => {
  it("maps the same calendar day to the same number and the next day to +1", () => {
    const morning = localDayNumber(new Date(2026, 0, 1, 9, 0).getTime());
    const night = localDayNumber(new Date(2026, 0, 1, 23, 30).getTime());
    const nextDay = localDayNumber(new Date(2026, 0, 2, 0, 30).getTime());
    expect(morning).toBe(night);
    expect(nextDay).toBe(morning + 1);
  });
});

describe("isCountablePracticeTurn", () => {
  it("counts real on-record learner input", () => {
    expect(
      isCountablePracticeTurn({
        userInput: "I went to work.",
        displayText: null,
        excludeFromContext: 0,
      }),
    ).toBe(true);
  });

  it("ignores empty openings, off-record turns, and prompt macros", () => {
    expect(
      isCountablePracticeTurn({
        userInput: "",
        displayText: null,
        excludeFromContext: 0,
      }),
    ).toBe(false);
    expect(
      isCountablePracticeTurn({
        userInput: "side question",
        displayText: null,
        excludeFromContext: 1,
      }),
    ).toBe(false);
    expect(
      isCountablePracticeTurn({
        userInput: "expanded instruction",
        displayText: "/topic work",
        excludeFromContext: 0,
      }),
    ).toBe(false);
  });
});
