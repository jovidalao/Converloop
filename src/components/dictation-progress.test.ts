import { describe, expect, it } from "vitest";
import {
  createEmptyDictationProgress,
  findNextUnmasteredItem,
  getDictationCursor,
  isDictationMastered,
  parseDictationProgress,
  recordDictationAttempt,
  selectionKey,
  setDictationCursor,
} from "./dictation-progress";

describe("dictation progress", () => {
  it("tracks correct and incorrect attempts separately for each prompt mode", () => {
    let progress = createEmptyDictationProgress();

    progress = recordDictationAttempt(
      progress,
      "turn-1:ai",
      "audio",
      false,
      100,
    );
    progress = recordDictationAttempt(
      progress,
      "turn-1:ai",
      "audio",
      true,
      200,
    );

    expect(progress.attempts["turn-1:ai"]?.audio).toEqual({
      correctCount: 1,
      incorrectCount: 1,
      lastResult: "correct",
      updatedAt: 200,
    });
    expect(isDictationMastered(progress, "turn-1:ai", "audio")).toBe(true);
    expect(isDictationMastered(progress, "turn-1:ai", "meaning")).toBe(false);
  });

  it("restores a separate cursor for each selection and prompt mode", () => {
    const key = selectionKey(["conversation-b", "conversation-a"]);
    let progress = createEmptyDictationProgress();

    progress = setDictationCursor(progress, key, "audio", "turn-2:user");
    progress = setDictationCursor(progress, key, "meaning", "turn-4:ai");

    expect(selectionKey(["conversation-a", "conversation-b"])).toBe(key);
    expect(getDictationCursor(progress, key, "audio")).toBe("turn-2:user");
    expect(getDictationCursor(progress, key, "meaning")).toBe("turn-4:ai");
    expect(
      getDictationCursor(progress, selectionKey(["conversation-a"]), "audio"),
    ).toBeNull();
  });

  it("falls back safely when persisted data is missing or malformed", () => {
    expect(parseDictationProgress(null)).toEqual(
      createEmptyDictationProgress(),
    );
    expect(parseDictationProgress("{bad json")).toEqual(
      createEmptyDictationProgress(),
    );
    expect(
      parseDictationProgress(
        JSON.stringify({
          version: 1,
          attempts: {
            "turn-1:ai": {
              audio: {
                correctCount: 2,
                incorrectCount: 3,
                lastResult: "incorrect",
                updatedAt: 123,
              },
            },
          },
          cursors: { selection: { audio: "turn-1:ai" } },
        }),
      ),
    ).toEqual({
      version: 1,
      attempts: {
        "turn-1:ai": {
          audio: {
            correctCount: 2,
            incorrectCount: 3,
            lastResult: "incorrect",
            updatedAt: 123,
          },
        },
      },
      cursors: { selection: { audio: "turn-1:ai" } },
    });
  });

  it("skips mastered items when moving through the source order", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const progress = recordDictationAttempt(
      createEmptyDictationProgress(),
      "two",
      "audio",
      true,
    );

    expect(findNextUnmasteredItem(items, "one", progress, "audio", 1)?.id).toBe(
      "three",
    );
    expect(
      findNextUnmasteredItem(items, "three", progress, "audio", 1)?.id,
    ).toBe("one");
    expect(
      findNextUnmasteredItem(items, "one", progress, "meaning", 1)?.id,
    ).toBe("two");
  });

  it("returns null once every line in the queue is mastered", () => {
    const items = [{ id: "one" }, { id: "two" }];
    let progress = createEmptyDictationProgress();
    progress = recordDictationAttempt(progress, "one", "audio", true);
    progress = recordDictationAttempt(progress, "two", "audio", true);

    expect(
      findNextUnmasteredItem(items, "one", progress, "audio", 1),
    ).toBeNull();
    expect(
      findNextUnmasteredItem(items, null, progress, "audio", 1),
    ).toBeNull();
  });

  it("walks backward through the source order, skipping mastered lines", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const progress = recordDictationAttempt(
      createEmptyDictationProgress(),
      "two",
      "audio",
      true,
    );

    expect(
      findNextUnmasteredItem(items, "three", progress, "audio", -1)?.id,
    ).toBe("one");
    expect(
      findNextUnmasteredItem(items, "one", progress, "audio", -1)?.id,
    ).toBe("three");
  });

  it("loops back to the same line when it is the last one unmastered", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }];
    let progress = createEmptyDictationProgress();
    progress = recordDictationAttempt(progress, "one", "audio", true);
    progress = recordDictationAttempt(progress, "three", "audio", true);

    expect(findNextUnmasteredItem(items, "two", progress, "audio", 1)?.id).toBe(
      "two",
    );
    expect(
      findNextUnmasteredItem(items, "two", progress, "audio", -1)?.id,
    ).toBe("two");
  });

  it("resumes from the correct end when the current line left the queue", () => {
    const items = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const progress = recordDictationAttempt(
      createEmptyDictationProgress(),
      "one",
      "audio",
      true,
    );

    // The cursor pointed at a now-filtered-out line: forward resumes from the
    // head, backward from the tail (both skipping mastered "one").
    expect(
      findNextUnmasteredItem(items, "removed", progress, "audio", 1)?.id,
    ).toBe("two");
    expect(
      findNextUnmasteredItem(items, "removed", progress, "audio", -1)?.id,
    ).toBe("three");
  });

  it("clears one prompt mode's cursor without disturbing the other", () => {
    const key = selectionKey(["conversation-a"]);
    let progress = createEmptyDictationProgress();
    progress = setDictationCursor(progress, key, "audio", "turn-1:ai");
    progress = setDictationCursor(progress, key, "meaning", "turn-2:ai");

    progress = setDictationCursor(progress, key, "audio", null);
    expect(getDictationCursor(progress, key, "audio")).toBeNull();
    expect(getDictationCursor(progress, key, "meaning")).toBe("turn-2:ai");

    progress = setDictationCursor(progress, key, "meaning", null);
    expect(getDictationCursor(progress, key, "meaning")).toBeNull();
    expect(progress.cursors[key]).toBeUndefined();
  });
});
