import { describe, expect, it } from "vitest";
import {
  segmentDictationSentences,
  toDictationPlainText,
} from "./dictation-text";

describe("toDictationPlainText", () => {
  it("removes emphasis markers from a conversation reply", () => {
    expect(
      toDictationPlainText(
        "Which do you **prefer to do**? Try *closing* ~~late~~.",
      ),
    ).toBe("Which do you prefer to do? Try closing late.");
  });

  it("keeps readable content from common Markdown structures", () => {
    expect(
      toDictationPlainText(
        "## Try this\n- Read [the guide](https://example.com) with `focus`.\n- Then answer.",
      ),
    ).toBe("Try this Read the guide with focus. Then answer.");
  });

  it("removes code fences but keeps their contents", () => {
    expect(toDictationPlainText("```text\nSpeak clearly.\n```")).toBe(
      "Speak clearly.",
    );
  });
});

describe("segmentDictationSentences", () => {
  it("splits a multi-sentence reply into one item per sentence", () => {
    expect(
      segmentDictationSentences(
        "I went to the market. Then I cooked dinner. It was great!",
      ),
    ).toEqual([
      "I went to the market.",
      "Then I cooked dinner.",
      "It was great!",
    ]);
  });

  it("folds a leading filler fragment into the next sentence", () => {
    expect(segmentDictationSentences("Yes. I can do that today.")).toEqual([
      "Yes. I can do that today.",
    ]);
  });

  it("merges a tiny fragment back so a real sentence is not lost", () => {
    expect(segmentDictationSentences("Mr. Smith went home early.")).toEqual([
      "Mr. Smith went home early.",
    ]);
  });

  it("returns a single item for a line with no sentence punctuation", () => {
    expect(segmentDictationSentences("just a phrase here")).toEqual([
      "just a phrase here",
    ]);
  });

  it("drops an ultra-short line entirely", () => {
    expect(segmentDictationSentences("Sure!")).toEqual([]);
  });

  it("does not split an over-long sentence at commas", () => {
    const long =
      "Actually, I have a lot of favorites, but since they're Chinese teas, I usually go for jasmine or oolong after dinner.";
    expect(segmentDictationSentences(long)).toEqual([long]);
  });

  it("breaks an over-long sentence on stronger clause punctuation", () => {
    const long =
      "I went to the market this morning; then I cooked a big lunch for everyone; finally I cleaned the whole kitchen before dark.";
    const out = segmentDictationSentences(long);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((s) => s.split(/\s+/).filter(Boolean).length <= 18)).toBe(
      true,
    );
    expect(out.join(" ")).toBe(long);
  });

  it("leaves a long sentence whole when it has no safe clause punctuation", () => {
    const runOn =
      "the quick brown fox jumped over the lazy sleeping dog again and again all day without taking a single quiet break";
    expect(segmentDictationSentences(runOn)).toEqual([runOn]);
  });

  it("does not split a short sentence that has commas", () => {
    expect(segmentDictationSentences("Yes, of course.")).toEqual([
      "Yes, of course.",
    ]);
  });
});
