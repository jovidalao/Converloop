import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_SPEAK_INTERVAL_SECONDS,
  defaultEdgeVoiceForLanguage,
  EDGE_AUTO_VOICE,
  EDGE_VOICES,
  normalizeAutoSpeakIntervalSeconds,
  resolveEdgeVoice,
  ttsSupportsLanguage,
} from "./config";

describe("ttsSupportsLanguage", () => {
  it("MiMo only supports Chinese/English", () => {
    expect(ttsSupportsLanguage("mimo", "Chinese")).toBe(true);
    expect(ttsSupportsLanguage("mimo", "English")).toBe(true);
    expect(ttsSupportsLanguage("mimo", "Japanese")).toBe(false);
    expect(ttsSupportsLanguage("mimo", "Spanish")).toBe(false);
  });

  it("Edge covers the full range", () => {
    expect(ttsSupportsLanguage("edge", "Japanese")).toBe(true);
    expect(ttsSupportsLanguage("edge", "Arabic")).toBe(true);
    expect(ttsSupportsLanguage("edge", "Klingon")).toBe(true);
  });
});

describe("defaultEdgeVoiceForLanguage", () => {
  it("returns a native voice per learning language", () => {
    expect(defaultEdgeVoiceForLanguage("Spanish")).toBe("es-ES-ElviraNeural");
    expect(defaultEdgeVoiceForLanguage("French")).toBe("fr-FR-DeniseNeural");
    expect(defaultEdgeVoiceForLanguage("Chinese")).toBe("zh-CN-XiaoxiaoNeural");
    expect(defaultEdgeVoiceForLanguage("Japanese")).toBe("ja-JP-NanamiNeural");
  });

  it("falls back to the English multilingual voice for unknown languages", () => {
    expect(defaultEdgeVoiceForLanguage("Klingon")).toBe(
      "en-US-EmmaMultilingualNeural",
    );
  });

  it("every language default exists in the voice picker list", () => {
    const ids = new Set(EDGE_VOICES.map((v) => v.id));
    for (const lang of [
      "English",
      "Spanish",
      "French",
      "German",
      "Italian",
      "Portuguese",
      "Russian",
      "Chinese",
      "Japanese",
      "Korean",
    ]) {
      expect(ids.has(defaultEdgeVoiceForLanguage(lang))).toBe(true);
    }
  });
});

describe("resolveEdgeVoice", () => {
  it("resolves the auto sentinel to the language default", () => {
    expect(resolveEdgeVoice(EDGE_AUTO_VOICE, "Spanish")).toBe(
      "es-ES-ElviraNeural",
    );
  });

  it("passes an explicit voice through unchanged", () => {
    expect(resolveEdgeVoice("ja-JP-NanamiNeural", "Spanish")).toBe(
      "ja-JP-NanamiNeural",
    );
  });
});

describe("normalizeAutoSpeakIntervalSeconds", () => {
  it("defaults to 3 seconds for invalid values", () => {
    expect(normalizeAutoSpeakIntervalSeconds(undefined)).toBe(
      DEFAULT_AUTO_SPEAK_INTERVAL_SECONDS,
    );
    expect(normalizeAutoSpeakIntervalSeconds(Number.NaN)).toBe(
      DEFAULT_AUTO_SPEAK_INTERVAL_SECONDS,
    );
  });

  it("keeps valid values within the supported range", () => {
    expect(normalizeAutoSpeakIntervalSeconds(3)).toBe(3);
    expect(normalizeAutoSpeakIntervalSeconds(-1)).toBe(0);
    expect(normalizeAutoSpeakIntervalSeconds(90)).toBe(60);
  });
});
