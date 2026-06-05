import { describe, expect, it } from "vitest";
import { rankMasteryItemsForInput } from "./mastery-relevance";

describe("rankMasteryItemsForInput", () => {
  it("puts items related to the current input first", () => {
    const items = [
      {
        key: "grammar:article_usage",
        label: "冠词 a/an/the",
        type: "grammar",
      },
      {
        key: "gap:push_back_deadline",
        label: "把 deadline 往后推",
        type: "expression_gap",
        notes: "Could we push the deadline back a few days?",
      },
    ];

    expect(
      rankMasteryItemsForInput(items, "Can we push back the deadline?").map(
        (item) => item.key,
      ),
    ).toEqual(["gap:push_back_deadline", "grammar:article_usage"]);
  });

  it("keeps original order when there is no query signal", () => {
    const items = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ];
    expect(rankMasteryItemsForInput(items, "").map((item) => item.key)).toEqual(
      ["a", "b"],
    );
  });
});
