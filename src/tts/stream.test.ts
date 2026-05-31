import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginSpeechStream: vi.fn(() => 1),
  endSpeechStream: vi.fn(),
  enqueueSpeech: vi.fn(),
  setSpeechStreamKey: vi.fn(),
  speakText: vi.fn(async () => new ArrayBuffer(1)),
}));

vi.mock("./playback", () => ({
  beginSpeechStream: mocks.beginSpeechStream,
  endSpeechStream: mocks.endSpeechStream,
  enqueueSpeech: mocks.enqueueSpeech,
  setSpeechStreamKey: mocks.setSpeechStreamKey,
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

  it("第一句少于 10 个词时,并入下一句作为第一段", async () => {
    const speaker = createReplySpeaker();

    speaker.push("Hi. This ");
    expect(mocks.speakText).not.toHaveBeenCalled();

    speaker.push(
      "Hi. This second sentence has enough words for the first chunk. Rest ",
    );
    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledWith(
        "Hi. This second sentence has enough words for the first chunk.",
      );
    });

    speaker.finish(
      "Hi. This second sentence has enough words for the first chunk. Rest stays together.",
    );
    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledTimes(2);
    });
    expect(mocks.speakText).toHaveBeenNthCalledWith(2, "Rest stays together.");
  });

  it("第一句已达 10 个词时,先合成第一句", async () => {
    const speaker = createReplySpeaker();

    speaker.push(
      "This first sentence already has more than ten simple words here. Rest ",
    );

    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledWith(
        "This first sentence already has more than ten simple words here.",
      );
    });

    speaker.finish(
      "This first sentence already has more than ten simple words here. Rest later.",
    );
    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledTimes(2);
    });
    expect(mocks.speakText).toHaveBeenNthCalledWith(2, "Rest later.");
  });

  it("回复结束前没凑够 10 个词时,把整段作为第一段", async () => {
    const speaker = createReplySpeaker();

    speaker.finish("Hello there. How are you?");

    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledTimes(1);
    });
    expect(mocks.speakText).toHaveBeenCalledWith("Hello there. How are you?");
  });

  it("没有句末标点的短回复只合成一次", async () => {
    const speaker = createReplySpeaker();

    speaker.finish("just a phrase");

    await vi.waitFor(() => {
      expect(mocks.speakText).toHaveBeenCalledTimes(1);
    });
    expect(mocks.speakText).toHaveBeenCalledWith("just a phrase");
  });
});
