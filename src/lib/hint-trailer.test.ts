import { describe, expect, it } from "vitest";
import { createHintDeltaGate, splitReplyTrailer } from "./hint-trailer";

describe("splitReplyTrailer", () => {
  it("splits a reply with a trailing hint line", () => {
    const { visible, hint } = splitReplyTrailer(
      "That sounds great! What did you cook?\n\n[[HINT]]描述你做的菜 → I made ___, it turned out pretty well.",
    );
    expect(visible).toBe("That sounds great! What did you cook?");
    expect(hint).toBe("描述你做的菜 → I made ___, it turned out pretty well.");
  });

  it("returns the whole text when there is no marker", () => {
    const { visible, hint } = splitReplyTrailer("Just a normal reply.");
    expect(visible).toBe("Just a normal reply.");
    expect(hint).toBeNull();
  });

  it("takes the first non-empty line after the marker and drops overrun", () => {
    const { visible, hint } = splitReplyTrailer(
      "Reply.\n[[HINT]]\n追问细节 → How did it go?\nextra overrun text",
    );
    expect(visible).toBe("Reply.");
    expect(hint).toBe("追问细节 → How did it go?");
  });

  it("returns null hint when the marker has nothing after it", () => {
    const { visible, hint } = splitReplyTrailer("Reply.\n[[HINT]]");
    expect(visible).toBe("Reply.");
    expect(hint).toBeNull();
  });

  it("trims a partial marker tail left by an aborted stream", () => {
    const { visible, hint } = splitReplyTrailer("Reply text…\n[[HI");
    expect(visible).toBe("Reply text…");
    expect(hint).toBeNull();
  });
});

describe("createHintDeltaGate", () => {
  function collectThrough(chunks: string[]): string {
    let out = "";
    const gate = createHintDeltaGate((d) => {
      out += d;
    });
    for (const chunk of chunks) gate(chunk);
    return out;
  }

  it("passes ordinary chunks through unchanged", () => {
    expect(collectThrough(["Hello ", "world", "!"])).toBe("Hello world!");
  });

  it("stops forwarding at the marker", () => {
    expect(
      collectThrough(["Nice! ", "What's next?\n[[HINT]]cue → opener"]),
    ).toBe("Nice! What's next?\n");
  });

  it("handles the marker split across chunks", () => {
    expect(
      collectThrough(["The reply ends here.", "[[HI", "NT]]cue → opener"]),
    ).toBe("The reply ends here.");
  });

  it("releases a held tail that turns out not to be the marker", () => {
    expect(collectThrough(["I scored [[", "8/10]] on it"])).toBe(
      "I scored [[8/10]] on it",
    );
  });

  it("swallows everything after the marker across later chunks", () => {
    expect(
      collectThrough(["Reply.", "[[HINT]]cue", " → more", " trailer"]),
    ).toBe("Reply.");
  });
});
