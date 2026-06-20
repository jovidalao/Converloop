import { describe, expect, it } from "vitest";
import { toDictationPlainText } from "./dictation-text";

describe("toDictationPlainText", () => {
  it("removes emphasis markers from a conversation reply", () => {
    expect(
      toDictationPlainText(
        "Which do you **prefer to do**? Try *closing* ~~late~~.",
      ),
    ).toBe("Which do you prefer to do? Try closing late.");
  });

  it("keeps readable content from common Markdown structures", () => {
    expect(
      toDictationPlainText(
        "## Try this\n- Read [the guide](https://example.com) with `focus`.\n- Then answer.",
      ),
    ).toBe("Try this Read the guide with focus. Then answer.");
  });

  it("removes code fences but keeps their contents", () => {
    expect(toDictationPlainText("```text\nSpeak clearly.\n```")).toBe(
      "Speak clearly.",
    );
  });
});
