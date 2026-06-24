import { describe, expect, it } from "vitest";
import type { Issue, TutorAnalysis } from "../agents/schema";
import type { ReviewItem } from "../db/mastery";
import type { ChatTurn } from "../db/turns";
import { resolveCoachFocus } from "./coach-focus";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    category: "grammar",
    span_original: "he go",
    span_corrected: "he goes",
    explanation: "third person singular needs -s",
    severity: "moderate",
    mastery_key: "grammar:third_person_s",
    mastery_label: "third person -s",
    mastery_type: "grammar",
    ...over,
  };
}

function analysis(over: Partial<TutorAnalysis> = {}): TutorAnalysis {
  return {
    is_correct: true,
    corrected: "",
    natural: "",
    issues: [],
    mastery_updates: [],
    highlight: null,
    expression_gap: null,
    ...over,
  };
}

function turn(id: string, over: Partial<ChatTurn> = {}): ChatTurn {
  return { id, userText: `text-${id}`, analysis: analysis(), ...over };
}

function due(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    key: "vocab:reschedule",
    label: "reschedule",
    type: "vocab",
    status: "weak",
    example: "Can we reschedule?",
    notes: null,
    retention: 0.4,
    dueScore: 1,
    ...over,
  };
}

describe("resolveCoachFocus — focus priority", () => {
  it("returns empty when there are no graded learner turns", () => {
    expect(resolveCoachFocus([], []).focus).toEqual({ kind: "empty" });
    // ungraded / off-record / prompt-macro turns don't count
    const ungraded = resolveCoachFocus(
      [
        turn("a", { analysis: null }),
        turn("b", { excludeFromContext: true }),
        turn("c", { displayText: "/topic food" }),
      ],
      [],
    );
    expect(ungraded.focus).toEqual({ kind: "empty" });
  });

  it("prioritizes a fresh expression gap on the latest turn", () => {
    const t = turn("t1", {
      analysis: analysis({
        is_correct: false,
        issues: [issue({ severity: "major" })],
        expression_gap: {
          mastery_key: "gap:decline_politely",
          mastery_label: "declining politely",
          original: "我想婉拒",
          target_expression: "I'd rather not, if that's okay.",
          template: "I'd rather not ___, but ___",
          explanation: "...",
          key_items: [],
        },
      }),
    });
    const { focus } = resolveCoachFocus([t], []);
    expect(focus.kind).toBe("gap");
    if (focus.kind === "gap") {
      expect(focus.target).toBe("I'd rather not, if that's okay.");
      expect(focus.template).toBe("I'd rather not ___, but ___");
    }
  });

  it("shows a fresh major fix ahead of an older recurring pattern", () => {
    const older = turn("t1", {
      analysis: analysis({ is_correct: false, issues: [issue()] }),
    });
    const older2 = turn("t2", {
      analysis: analysis({ is_correct: false, issues: [issue()] }),
    });
    const latest = turn("t3", {
      analysis: analysis({
        is_correct: false,
        issues: [
          issue({
            severity: "major",
            mastery_key: "vocab:affect_effect",
            mastery_label: "affect vs effect",
            span_original: "effect",
            span_corrected: "affect",
          }),
        ],
      }),
    });
    const { focus } = resolveCoachFocus([older, older2, latest], []);
    expect(focus.kind).toBe("fix");
    if (focus.kind === "fix") {
      expect(focus.severity).toBe("major");
      expect(focus.masteryKey).toBe("vocab:affect_effect");
    }
  });

  it("surfaces a recurring pattern when the latest slip is only minor", () => {
    const t1 = turn("t1", {
      analysis: analysis({ is_correct: false, issues: [issue()] }),
    });
    const t2 = turn("t2", {
      analysis: analysis({
        is_correct: false,
        issues: [
          issue({ span_original: "she go", span_corrected: "she goes" }),
        ],
      }),
    });
    const { focus } = resolveCoachFocus([t1, t2], []);
    expect(focus.kind).toBe("recurring");
    if (focus.kind === "recurring") {
      expect(focus.count).toBe(2);
      expect(focus.masteryKey).toBe("grammar:third_person_s");
      // keeps the most recent occurrence's example
      expect(focus.original).toBe("she go");
    }
  });

  it("falls back to the latest minor fix when nothing recurs", () => {
    const t = turn("t1", {
      analysis: analysis({
        is_correct: false,
        issues: [issue({ severity: "minor" })],
      }),
    });
    const { focus } = resolveCoachFocus([t], []);
    expect(focus.kind).toBe("fix");
  });

  it("praises a clean sentence that has a highlight", () => {
    const t = turn("t1", {
      analysis: analysis({
        is_correct: true,
        highlight: "nice idiom: on the fence",
      }),
    });
    const { focus } = resolveCoachFocus([t], []);
    expect(focus).toEqual({
      kind: "praise",
      turnId: "t1",
      highlight: "nice idiom: on the fence",
    });
  });

  it("returns clean for a flawless sentence with no highlight", () => {
    const { focus } = resolveCoachFocus([turn("t1")], []);
    expect(focus).toEqual({ kind: "clean", turnId: "t1" });
  });
});

describe("resolveCoachFocus — recall target", () => {
  it("picks the weakest due item", () => {
    const { recall } = resolveCoachFocus([turn("t1")], [due()]);
    expect(recall?.key).toBe("vocab:reschedule");
  });

  it("does not repeat the item already shown as the focus", () => {
    const t = turn("t1", {
      analysis: analysis({
        is_correct: false,
        issues: [
          issue({
            mastery_key: "vocab:reschedule",
            mastery_label: "reschedule",
          }),
        ],
      }),
    });
    const items = [
      due({ key: "vocab:reschedule" }),
      due({ key: "vocab:itinerary", label: "itinerary" }),
    ];
    const { focus, recall } = resolveCoachFocus([t], items);
    expect(focus.kind).toBe("fix");
    expect(recall?.key).toBe("vocab:itinerary");
  });

  it("returns null recall when there are no due items", () => {
    expect(resolveCoachFocus([turn("t1")], []).recall).toBeNull();
  });
});
