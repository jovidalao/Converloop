import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playSpeech: vi.fn(async () => {}),
  speakText: vi.fn(async () => new ArrayBuffer(1)),
}));

vi.mock("./playback", () => ({
  playSpeech: mocks.playSpeech,
}));

vi.mock("./speak", () => ({
  MissingTtsApiKeyError: class MissingTtsApiKeyError extends Error {},
  speakText: mocks.speakText,
}));

import { createReplySpeaker } from "./stream";

describe("createReplySpeaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("整条回复一次性合成并播放", async () => {
    const speaker = createReplySpeaker();
    const reply = "Hi. This is the whole reply. It plays as one piece.";

    speaker.finish(reply);

    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledTimes(1);
    });
    expect(mocks.speakText).toHaveBeenCalledWith(reply);
    await vi.waitFor(() => {
      expect(mocks.playSpeech).toHaveBeenCalledWith(expect.anything(), reply);
    });
  });

  it("空回复不合成", () => {
    const speaker = createReplySpeaker();
    speaker.finish("   ");
    expect(mocks.speakText).not.toHaveBeenCalled();
  });

  it("中止后不再播放", async () => {
    const speaker = createReplySpeaker();
    speaker.finish("Some reply text.");
    speaker.abort();

    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledTimes(1);
    });
    expect(mocks.playSpeech).not.toHaveBeenCalled();
  });
});
