import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsConfig } from "./config";

// Shared mocks: Tauri invoke (Rust synthesis command), cache (no IndexedDB), config (no localStorage read).
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  loadTtsConfig: vi.fn(),
  getMimoTtsApiKey: vi.fn(),
  buildTtsCacheKey: vi.fn(async () => "cache-key"),
  getCachedSpeech: vi.fn(async () => null),
  setCachedSpeech: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

vi.mock("./cache", () => ({
  buildTtsCacheKey: mocks.buildTtsCacheKey,
  getCachedSpeech: mocks.getCachedSpeech,
  setCachedSpeech: mocks.setCachedSpeech,
  clearTtsCache: vi.fn(),
  getTtsCacheCount: vi.fn(),
}));

vi.mock("./config", () => ({
  loadTtsConfig: mocks.loadTtsConfig,
  getMimoTtsApiKey: mocks.getMimoTtsApiKey,
  MissingTtsApiKeyError: class MissingTtsApiKeyError extends Error {},
}));

import { synthesizeEdge } from "./edge";
import { speakText } from "./speak";

// "AQID" = base64 of bytes [1, 2, 3].
const B64_123 = "AQID";

const edgeConfig: TtsConfig = {
  ttsProvider: "edge",
  baseUrl: "",
  model: "",
  voice: "",
  stylePrompt: "",
  edgeVoice: "en-US-EmmaMultilingualNeural",
  edgeRate: "+0%",
  edgePitch: "+0Hz",
  autoSpeak: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedSpeech.mockResolvedValue(null);
  mocks.buildTtsCacheKey.mockResolvedValue("cache-key");
});

describe("synthesizeEdge", () => {
  it("calls edge_tts_synthesize and decodes base64 to ArrayBuffer", async () => {
    mocks.invoke.mockResolvedValueOnce(B64_123);
    const buf = await synthesizeEdge({
      text: "hi",
      voice: "V",
      rate: "+0%",
      pitch: "+0Hz",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("edge_tts_synthesize", {
      text: "hi",
      voice: "V",
      rate: "+0%",
      pitch: "+0Hz",
    });
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("speakText engine routing", () => {
  it("edge engine needs no key: skips MiMo key lookup and goes straight to Edge synthesis", async () => {
    mocks.loadTtsConfig.mockReturnValue(edgeConfig);
    mocks.invoke.mockResolvedValueOnce(B64_123);

    const buf = await speakText("hello");

    expect(mocks.getMimoTtsApiKey).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith(
      "edge_tts_synthesize",
      expect.objectContaining({
        text: "hello",
        voice: "en-US-EmmaMultilingualNeural",
        rate: "+0%",
        pitch: "+0Hz",
      }),
    );
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    expect(mocks.setCachedSpeech).toHaveBeenCalled();
  });
});
