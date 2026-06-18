import { describe, expect, it } from "vitest";
import {
  languageHintsFor,
  sttLanguageSupport,
  sttSupportsLanguage,
} from "./config";

describe("sttSupportsLanguage", () => {
  it("cloud engines auto-detect any language", () => {
    expect(sttSupportsLanguage("soniox", "Japanese")).toBe(true);
    expect(sttSupportsLanguage("openai", "Chinese")).toBe(true);
  });

  it("Parakeet (European-only) can't do CJK", () => {
    expect(sttSupportsLanguage("parakeet", "Chinese")).toBe(false);
    expect(sttSupportsLanguage("parakeet", "Japanese")).toBe(false);
    expect(sttSupportsLanguage("parakeet", "Korean")).toBe(false);
    expect(sttSupportsLanguage("parakeet", "Spanish")).toBe(true);
    expect(sttSupportsLanguage("parakeet", "German")).toBe(true);
  });

  it("Qwen3 is used for Chinese, not unverified Japanese/Korean", () => {
    expect(sttSupportsLanguage("qwen3", "Chinese")).toBe(true);
    expect(sttSupportsLanguage("qwen3", "Japanese")).toBe(false);
    expect(sttSupportsLanguage("qwen3", "Korean")).toBe(false);
    expect(sttLanguageSupport("qwen3", "Japanese")).toBe("unverified");
    expect(sttLanguageSupport("qwen3", "Korean")).toBe("unverified");
  });

  it("builds Soniox hints for configured target and native languages", () => {
    expect(languageHintsFor(["Japanese", "Traditional Chinese"])).toEqual([
      "ja",
      "zh",
    ]);
    expect(languageHintsFor(["English", "Arabic", "English"])).toEqual([
      "en",
      "ar",
    ]);
  });
});
