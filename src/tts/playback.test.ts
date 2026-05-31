import { afterEach, describe, expect, it } from "vitest";
import {
  beginSpeechStream,
  getPlaybackSnapshot,
  setSpeechStreamKey,
  stopSpeech,
} from "./playback";

describe("playback snapshot", () => {
  afterEach(() => {
    stopSpeech();
  });

  it("marks a keyed stream as loading before audio is enqueued", () => {
    const token = beginSpeechStream(null);
    setSpeechStreamKey(token, "reply text");

    expect(getPlaybackSnapshot()).toEqual({
      key: "reply text",
      phase: "loading",
    });
  });

  it("clears the snapshot on stop", () => {
    const token = beginSpeechStream("reply text");
    setSpeechStreamKey(token, "reply text");

    stopSpeech();

    expect(getPlaybackSnapshot()).toEqual({ key: null, phase: null });
  });
});
