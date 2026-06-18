import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindingHasModifier,
  bindingKeyCaps,
  bindingMatchesEvent,
  bindingsEqual,
  EDITABLE_ACTIONS,
  type KeyBinding,
} from "./app-actions";

// Platform detection reads navigator.userAgent (see lib/platform.ts), so drive it
// per block: `meta` is the primary command modifier — ⌘ on macOS, Ctrl on Windows.
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

function setPlatform(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const evt = (over: Partial<KeyboardEvent>) => ({
  key: "n",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("bindingKeyCaps on macOS", () => {
  beforeEach(() => setPlatform(MAC_UA));

  it("renders modifiers in mac order then the uppercased key", () => {
    expect(bindingKeyCaps({ key: "n", meta: true })).toEqual(["⌘", "N"]);
    expect(
      bindingKeyCaps({
        key: "k",
        ctrl: true,
        alt: true,
        shift: true,
        meta: true,
      }),
    ).toEqual(["⌃", "⌥", "⇧", "⌘", "K"]);
  });

  it("maps named keys to symbols", () => {
    expect(bindingKeyCaps({ key: "Escape", meta: true })).toEqual(["⌘", "Esc"]);
    expect(bindingKeyCaps({ key: ",", meta: true })).toEqual(["⌘", ","]);
  });
});

describe("bindingKeyCaps on Windows", () => {
  beforeEach(() => setPlatform(WIN_UA));

  it("renders text labels in Ctrl-first order, primary modifier as Ctrl", () => {
    expect(bindingKeyCaps({ key: "n", meta: true })).toEqual(["Ctrl", "N"]);
    expect(bindingKeyCaps({ key: "v", meta: true, shift: true })).toEqual([
      "Ctrl",
      "Shift",
      "V",
    ]);
  });

  it("folds the primary and literal Ctrl into a single Ctrl cap", () => {
    expect(
      bindingKeyCaps({
        key: "k",
        ctrl: true,
        alt: true,
        shift: true,
        meta: true,
      }),
    ).toEqual(["Ctrl", "Alt", "Shift", "K"]);
  });

  it("maps named keys with the windows primary modifier", () => {
    expect(bindingKeyCaps({ key: "Escape", meta: true })).toEqual([
      "Ctrl",
      "Esc",
    ]);
  });
});

describe("bindingMatchesEvent on macOS", () => {
  beforeEach(() => setPlatform(MAC_UA));

  it("matches when key and all modifiers agree", () => {
    expect(
      bindingMatchesEvent(
        { key: "n", meta: true },
        evt({ key: "n", metaKey: true }),
      ),
    ).toBe(true);
  });

  it("lowercases single-character keys before comparing", () => {
    expect(
      bindingMatchesEvent(
        { key: "n", meta: true },
        evt({ key: "N", metaKey: true }),
      ),
    ).toBe(true);
  });

  it("rejects when an extra modifier is held", () => {
    expect(
      bindingMatchesEvent(
        { key: "n", meta: true },
        evt({ key: "n", metaKey: true, shiftKey: true }),
      ),
    ).toBe(false);
  });

  it("rejects when the modifier is missing", () => {
    expect(
      bindingMatchesEvent({ key: "n", meta: true }, evt({ key: "n" })),
    ).toBe(false);
  });

  it("does not treat Ctrl as the primary modifier", () => {
    expect(
      bindingMatchesEvent(
        { key: "n", meta: true },
        evt({ key: "n", ctrlKey: true }),
      ),
    ).toBe(false);
  });
});

describe("bindingMatchesEvent on Windows", () => {
  beforeEach(() => setPlatform(WIN_UA));

  it("fires a meta (primary) chord on Ctrl, not the Win key", () => {
    expect(
      bindingMatchesEvent(
        { key: "n", meta: true },
        evt({ key: "n", ctrlKey: true }),
      ),
    ).toBe(true);
    expect(
      bindingMatchesEvent(
        { key: "n", meta: true },
        evt({ key: "n", metaKey: true }),
      ),
    ).toBe(false);
  });

  it("matches a meta+shift chord on Ctrl+Shift", () => {
    expect(
      bindingMatchesEvent(
        { key: "v", meta: true, shift: true },
        evt({ key: "v", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true);
  });

  it("rejects when Ctrl is missing", () => {
    expect(
      bindingMatchesEvent({ key: "n", meta: true }, evt({ key: "n" })),
    ).toBe(false);
  });
});

describe("bindingsEqual", () => {
  it("treats absent and false modifiers as equal", () => {
    expect(
      bindingsEqual({ key: "n", meta: true }, { key: "n", meta: true }),
    ).toBe(true);
    expect(
      bindingsEqual(
        { key: "n", meta: true },
        { key: "n", meta: true, shift: false },
      ),
    ).toBe(true);
  });

  it("distinguishes different chords", () => {
    expect(
      bindingsEqual({ key: "n", meta: true }, { key: "n", ctrl: true }),
    ).toBe(false);
  });
});

describe("bindingHasModifier", () => {
  it("requires a non-shift modifier", () => {
    expect(bindingHasModifier({ key: "n", meta: true })).toBe(true);
    expect(bindingHasModifier({ key: "n", ctrl: true })).toBe(true);
    expect(bindingHasModifier({ key: "n", shift: true })).toBe(false);
    expect(bindingHasModifier({ key: "n" })).toBe(false);
  });
});

describe("default keybindings", () => {
  it("every editable default has a non-shift modifier so it can't fire while typing", () => {
    for (const action of EDITABLE_ACTIONS) {
      expect(
        bindingHasModifier(action.defaultBinding),
        `${action.id} default needs a ⌘/⌃/⌥ modifier`,
      ).toBe(true);
    }
  });

  it("no two editable defaults share a chord", () => {
    const seen: KeyBinding[] = [];
    for (const action of EDITABLE_ACTIONS) {
      const dup = seen.find((b) => bindingsEqual(b, action.defaultBinding));
      expect(dup, `${action.id} reuses an existing default chord`).toBe(
        undefined,
      );
      seen.push(action.defaultBinding);
    }
  });
});
