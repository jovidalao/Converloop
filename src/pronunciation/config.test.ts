import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPronunciationConfig,
  PRONUNCIATION_PROVIDER_PRESETS,
  PRONUNCIATION_PROVIDERS,
} from "./config";

function stubStorage(value: unknown) {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => (value == null ? null : JSON.stringify(value))),
    setItem: vi.fn(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pronunciation config", () => {
  it("has complete presets for every assessment provider", () => {
    for (const provider of PRONUNCIATION_PROVIDERS) {
      const preset = PRONUNCIATION_PROVIDER_PRESETS[provider];
      expect(preset.label.trim()).not.toBe("");
      expect(preset.shortLabel.trim()).not.toBe("");
      expect(preset.model.trim()).not.toBe("");
      expect(preset.models.map((m) => m.model)).toContain(preset.model);
    }
  });

  it("loads defaults with pronunciation disabled", () => {
    stubStorage(null);
    expect(loadPronunciationConfig()).toEqual({
      provider: null,
      models: {
        gemini: PRONUNCIATION_PROVIDER_PRESETS.gemini.model,
        openai: PRONUNCIATION_PROVIDER_PRESETS.openai.model,
      },
    });
  });

  it("migrates the legacy Gemini-only model field", () => {
    stubStorage({ provider: "gemini", model: "gemini-1.5-pro" });
    expect(loadPronunciationConfig()).toEqual({
      provider: "gemini",
      models: {
        gemini: "gemini-1.5-pro",
        openai: PRONUNCIATION_PROVIDER_PRESETS.openai.model,
      },
    });
  });

  it("keeps per-provider model choices", () => {
    stubStorage({
      provider: "openai",
      models: { gemini: "gemini-1.5-flash", openai: "gpt-audio-custom" },
    });
    expect(loadPronunciationConfig()).toEqual({
      provider: "openai",
      models: {
        gemini: "gemini-1.5-flash",
        openai: "gpt-audio-custom",
      },
    });
  });
});
