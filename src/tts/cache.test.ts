import { describe, expect, it } from "vitest";
import { buildTtsCacheKey } from "./cache";
import type { TtsConfig } from "./config";

const cfg: TtsConfig = {
  ttsProvider: "mimo",
  baseUrl: "http://example/v1",
  model: "mimo-v2.5-tts",
  voice: "Chloe",
  stylePrompt: "Clear tone.",
  edgeVoice: "en-US-EmmaMultilingualNeural",
  edgeRate: "+0%",
  edgePitch: "+0Hz",
  autoSpeak: true,
};

describe("buildTtsCacheKey", () => {
  it("same text and config produce the same key", async () => {
    const a = await buildTtsCacheKey("Hello", cfg);
    const b = await buildTtsCacheKey("Hello", cfg);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("different text or voice produces a different key", async () => {
    const base = await buildTtsCacheKey("Hello", cfg);
    const otherText = await buildTtsCacheKey("Hi", cfg);
    const otherVoice = await buildTtsCacheKey("Hello", {
      ...cfg,
      voice: "Milo",
    });
    expect(otherText).not.toBe(base);
    expect(otherVoice).not.toBe(base);
  });
});
