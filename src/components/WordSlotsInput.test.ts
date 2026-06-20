import { describe, expect, it } from "vitest";
import { applyDictationHint, dictationSlotWords } from "./WordSlotsInput";

describe("dictationSlotWords", () => {
  it("returns the text used to measure each target word", () => {
    expect(dictationSlotWords("Let's ship version 12 today.")).toEqual([
      "Lets",
      "ship",
      "version",
      "12",
      "today",
    ]);
  });

  it("does not create slots for standalone punctuation", () => {
    expect(dictationSlotWords("wait — really?")).toEqual(["wait", "really"]);
  });

  it("keeps Unicode letters for proportional-font measurement", () => {
    expect(dictationSlotWords("你好 café")).toEqual(["你好", "café"]);
  });
});

describe("applyDictationHint", () => {
  it("replaces the partial word in the active slot and advances", () => {
    expect(applyDictationHint("I sl", "I slightly prefer tea.")).toBe(
      "I slightly ",
    );
  });

  it("fills the fresh slot after a completed word", () => {
    expect(applyDictationHint("I ", "I slightly prefer tea.")).toBe(
      "I slightly ",
    );
  });

  it("preserves meaningful punctuation inside a word", () => {
    expect(applyDictationHint("", "Don't stop.")).toBe("Don't ");
  });

  it("does not add a hint beyond the target sentence", () => {
    expect(applyDictationHint("all done ", "all done")).toBeNull();
  });
});
