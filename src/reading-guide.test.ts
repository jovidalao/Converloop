import { describe, expect, it } from "vitest";
import { readingGuideSegments, supportsReadingGuide } from "./reading-guide";

describe("readingGuideSegments", () => {
  it("supports Chinese and Japanese only", () => {
    expect(supportsReadingGuide("Chinese")).toBe(true);
    expect(supportsReadingGuide("Japanese")).toBe(true);
    expect(supportsReadingGuide("Korean")).toBe(false);
    expect(supportsReadingGuide("English")).toBe(false);
  });

  it("adds pinyin to Chinese Han runs without touching surrounding text", () => {
    expect(readingGuideSegments("Hi 中国!", "Chinese")).toEqual([
      { text: "Hi " },
      { text: "中国", reading: "zhōng guó" },
      { text: "!" },
    ]);
  });

  it("adds furigana only for known Japanese dictionary entries", () => {
    expect(readingGuideSegments("今日は未知語です。", "Japanese")).toEqual([
      { text: "今日", reading: "きょう" },
      { text: "は未知語です。" },
    ]);
  });
});
