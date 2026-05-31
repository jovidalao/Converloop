import { describe, expect, it } from "vitest";
import { buildTtsCacheKey } from "./cache";
import type { TtsConfig } from "./config";

const cfg: TtsConfig = {
  baseUrl: "http://example/v1",
  model: "mimo-v2.5-tts",
  voice: "Chloe",
  stylePrompt: "Clear tone.",
  autoSpeak: true,
};

describe("buildTtsCacheKey", () => {
  it("相同文本与配置生成相同 key", async () => {
    const a = await buildTtsCacheKey("Hello", cfg);
    const b = await buildTtsCacheKey("Hello", cfg);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("文本或音色变化则 key 不同", async () => {
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
