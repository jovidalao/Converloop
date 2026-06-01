import { afterEach, describe, expect, it } from "vitest";
import { getPlaybackSnapshot, stopSpeech, subscribePlayback } from "./playback";

describe("playback snapshot", () => {
  afterEach(() => {
    stopSpeech();
  });

  it("空闲时快照为空", () => {
    stopSpeech();
    expect(getPlaybackSnapshot()).toEqual({ key: null, phase: null });
  });

  it("stopSpeech 会通知订阅者并清空快照", () => {
    let notified = 0;
    const unsubscribe = subscribePlayback(() => {
      notified += 1;
    });

    stopSpeech();

    expect(notified).toBeGreaterThan(0);
    expect(getPlaybackSnapshot()).toEqual({ key: null, phase: null });
    unsubscribe();
  });
});
