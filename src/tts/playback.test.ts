import { afterEach, describe, expect, it } from "vitest";
import { getPlaybackSnapshot, stopSpeech, subscribePlayback } from "./playback";

describe("playback snapshot", () => {
  afterEach(() => {
    stopSpeech();
  });

  it("snapshot is empty when idle", () => {
    stopSpeech();
    expect(getPlaybackSnapshot()).toEqual({ key: null, phase: null });
  });

  it("stopSpeech notifies subscribers and clears the snapshot", () => {
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
