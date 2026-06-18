import { describe, expect, it } from "vitest";
import { checkDictation } from "./dictation-diff";

const statuses = (expected: string, actual: string) =>
  checkDictation(expected, actual).expectedTokens.map((t) => t.status);

describe("checkDictation", () => {
  it("treats an exact answer as correct, ignoring case and punctuation", () => {
    const r = checkDictation("Let's ship it today.", "lets ship it today");
    expect(r.correct).toBe(true);
    expect(r.expectedTokens.every((t) => t.status === "hit")).toBe(true);
  });

  it("marks a missing word as a miss and the attempt as incorrect", () => {
    const r = checkDictation("I can run the tests now", "I can the tests now");
    expect(r.correct).toBe(false);
    expect(statuses("I can run the tests now", "I can the tests now")).toEqual([
      "hit",
      "hit",
      "miss",
      "hit",
      "hit",
      "hit",
    ]);
    expect(r.expectedTokens[2].text).toBe("run");
  });

  it("is incorrect when the answer has an extra word", () => {
    const r = checkDictation("ship it now", "ship it right now");
    expect(r.correct).toBe(false);
    // Every target word was still heard, so each is a hit even though the attempt is wrong overall.
    expect(r.expectedTokens.every((t) => t.status === "hit")).toBe(true);
  });

  it("flags a misheard word", () => {
    const r = checkDictation("deploy the build", "destroy the build");
    expect(r.correct).toBe(false);
    expect(statuses("deploy the build", "destroy the build")).toEqual([
      "miss",
      "hit",
      "hit",
    ]);
  });

  it("never counts a punctuation-only token as a miss", () => {
    const r = checkDictation("wait — really?", "wait really");
    expect(r.correct).toBe(true);
    expect(r.expectedTokens.map((t) => t.status)).toEqual([
      "hit",
      "hit",
      "hit",
    ]);
  });

  it("marks every word missed for an empty answer", () => {
    const r = checkDictation("two words", "");
    expect(r.correct).toBe(false);
    expect(r.expectedTokens.map((t) => t.status)).toEqual(["miss", "miss"]);
  });
});
