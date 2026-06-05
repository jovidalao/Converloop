import { describe, expect, it } from "vitest";
import { fallbackSelectionLearningItem } from "./selection-learning-item";

describe("fallbackSelectionLearningItem", () => {
  it("classifies a single selected word as vocab", () => {
    const item = fallbackSelectionLearningItem("deadline", "push the deadline");
    expect(item).toMatchObject({
      key: "vocab:deadline",
      label: "deadline",
      type: "vocab",
      status: "learning",
    });
  });

  it("classifies a short selected phrase as collocation", () => {
    const item = fallbackSelectionLearningItem(
      "push back the deadline",
      "Could we push back the deadline?",
    );
    expect(item).toMatchObject({
      key: "collocation:push_back_the_deadline",
      type: "collocation",
    });
  });
});
