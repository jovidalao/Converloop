import { describe, expect, it } from "vitest";
import {
  bindingHasModifier,
  bindingKeyCaps,
  bindingMatchesEvent,
  bindingsEqual,
} from "./app-actions";

describe("bindingKeyCaps", () => {
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

describe("bindingMatchesEvent", () => {
  const evt = (over: Partial<KeyboardEvent>) => ({
    key: "n",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });

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
