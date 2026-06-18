import { describe, expect, it } from "vitest";
import { languageToBcp47, segmentWords } from "./language";

describe("languageToBcp47", () => {
  it("maps the study-language display names", () => {
    expect(languageToBcp47("English")).toBe("en");
    expect(languageToBcp47("Chinese")).toBe("zh");
    expect(languageToBcp47("Japanese")).toBe("ja");
    expect(languageToBcp47("Korean")).toBe("ko");
    expect(languageToBcp47("Spanish")).toBe("es");
    expect(languageToBcp47("French")).toBe("fr");
    expect(languageToBcp47("German")).toBe("de");
    expect(languageToBcp47("Portuguese")).toBe("pt");
    expect(languageToBcp47("Russian")).toBe("ru");
    expect(languageToBcp47("Italian")).toBe("it");
    expect(languageToBcp47("Simplified Chinese")).toBe("zh");
    expect(languageToBcp47("Traditional Chinese")).toBe("zh");
    expect(languageToBcp47("Arabic")).toBe("ar");
    expect(languageToBcp47("Hindi")).toBe("hi");
    expect(languageToBcp47("Turkish")).toBe("tr");
    expect(languageToBcp47("Vietnamese")).toBe("vi");
    expect(languageToBcp47("Indonesian")).toBe("id");
    expect(languageToBcp47("Bengali")).toBe("bn");
    expect(languageToBcp47("Polish")).toBe("pl");
    expect(languageToBcp47("Thai")).toBe("th");
    expect(languageToBcp47("Ukrainian")).toBe("uk");
  });

  it("accepts native forms and bare codes", () => {
    expect(languageToBcp47("中文")).toBe("zh");
    expect(languageToBcp47("繁體中文")).toBe("zh");
    expect(languageToBcp47("日本語")).toBe("ja");
    expect(languageToBcp47("español")).toBe("es");
    expect(languageToBcp47("ภาษาไทย")).toBe("th");
    expect(languageToBcp47("ja")).toBe("ja");
  });

  it("returns '' for unknown or empty input", () => {
    expect(languageToBcp47("Klingon")).toBe("");
    expect(languageToBcp47("")).toBe("");
  });
});

describe("segmentWords", () => {
  it("splits CJK (no spaces) into separate words instead of one token", () => {
    const words = segmentWords("我今天很忙", "zh");
    expect(words).toContain("今天");
    expect(words.length).toBeGreaterThan(1);
  });

  it("returns word-like tokens for spaced scripts", () => {
    expect(segmentWords("hello world", "en")).toEqual(["hello", "world"]);
  });
});
