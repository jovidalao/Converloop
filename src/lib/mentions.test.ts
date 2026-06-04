import { describe, expect, it } from "vitest";
import {
  applyMention,
  filterMentions,
  type MentionItem,
  mentionQueryAt,
  toMentionItem,
} from "./mentions";

const items: MentionItem[] = [
  {
    key: "grammar:article_usage",
    label: "article usage",
    type: "grammar",
    insertText: "article usage",
  },
  {
    key: "gap:decline",
    label: "委婉拒绝",
    type: "expression_gap",
    insertText: "I'd rather not",
  },
];

describe("mentionQueryAt", () => {
  it("detects an @token typed at the caret", () => {
    expect(mentionQueryAt("How do I use @art", 17)).toEqual({
      token: "art",
      start: 13,
    });
  });

  it("opens on a bare @ at start", () => {
    expect(mentionQueryAt("@", 1)).toEqual({ token: "", start: 0 });
  });

  it("ignores @ that is not preceded by start/space (e.g. emails)", () => {
    expect(mentionQueryAt("mail a@b", 8)).toBeNull();
  });

  it("returns null with no @", () => {
    expect(mentionQueryAt("hello", 5)).toBeNull();
  });
});

describe("filterMentions", () => {
  it("returns all (capped) for an empty token", () => {
    expect(filterMentions(items, "")).toHaveLength(2);
  });

  it("matches on label", () => {
    expect(filterMentions(items, "art").map((i) => i.key)).toEqual([
      "grammar:article_usage",
    ]);
  });

  it("matches on insertText (target expression)", () => {
    expect(filterMentions(items, "rather").map((i) => i.key)).toEqual([
      "gap:decline",
    ]);
  });
});

describe("toMentionItem", () => {
  it("uses the target expression (notes) for expression gaps", () => {
    expect(
      toMentionItem({
        key: "gap:x",
        label: "委婉拒绝",
        type: "expression_gap",
        notes: "I'd rather not",
      }).insertText,
    ).toBe("I'd rather not");
  });

  it("falls back to the label for other types", () => {
    expect(
      toMentionItem({
        key: "grammar:x",
        label: "article usage",
        type: "grammar",
        notes: null,
      }).insertText,
    ).toBe("article usage");
  });
});

describe("applyMention", () => {
  it("replaces the @token with the insert text + a trailing space", () => {
    const r = applyMention("use @art", 8, items[0]);
    expect(r).toEqual({ value: "use article usage ", caret: 18 });
  });

  it("preserves text after the caret", () => {
    const r = applyMention("@art done", 4, items[0]);
    expect(r?.value).toBe("article usage  done");
  });
});
