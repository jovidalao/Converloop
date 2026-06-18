import { describe, expect, it, vi } from "vitest";
import { staticT, UI_LOCALES } from "./index";

describe("i18n locale resources", () => {
  it("registers the requested interface languages", () => {
    expect(UI_LOCALES.map((l) => l.value)).toEqual([
      "en",
      "es",
      "pt",
      "zh-CN",
      "zh-TW",
      "ar",
      "hi",
      "ru",
      "fr",
      "tr",
      "vi",
      "id",
      "ja",
      "de",
      "bn",
      "pl",
      "it",
      "ko",
      "th",
      "uk",
    ]);
  });

  it("migrates the legacy zh locale to Simplified Chinese", () => {
    vi.stubGlobal("localStorage", { getItem: () => "zh" });
    expect(staticT("common.save")).toBe("保存");
    vi.unstubAllGlobals();
  });
});
