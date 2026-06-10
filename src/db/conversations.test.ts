import { describe, expect, it } from "vitest";
import {
  type AgentModifiers,
  conversationType,
  formatModifierInstructions,
  parseDictationReply,
} from "./conversations";

describe("formatModifierInstructions drill blocks", () => {
  it("dictation block weaves in listening focus words and the replay note", () => {
    const mods: AgentModifiers = { dictation: { theme: "travel" } };
    const text = formatModifierInstructions(mods, {
      dictationFocusWords: ["receipt", "aisle"],
      replayNote: "PACING — the learner needed 3 replay(s).",
    });
    expect(text).toContain("DICTATION DRILL");
    expect(text).toContain('"receipt"');
    expect(text).toContain('"aisle"');
    expect(text).toContain("PACING — the learner needed 3 replay(s).");
  });

  it("dictation block omits the review section when there are no focus words", () => {
    const text = formatModifierInstructions({
      dictation: { theme: "travel" },
    });
    expect(text).toContain("DICTATION DRILL");
    expect(text).not.toContain("LISTENING REVIEW");
  });

  it("shadowing block uses the shared [[SAY]] contract", () => {
    const text = formatModifierInstructions({
      shadowing: { theme: "small talk" },
    });
    expect(text).toContain("SHADOWING (READ-ALOUD) DRILL");
    expect(text).toContain("[[SAY]]");
    expect(text).toContain("[[/SAY]]");
  });

  it("review drill block lists items in order and forbids revealing the target", () => {
    const text = formatModifierInstructions({
      reviewDrill: {
        items: [
          {
            key: "grammar:article_usage",
            label: "冠词使用",
            type: "grammar",
            example: "I bought apple",
            notes: null,
          },
          {
            key: "gap:decline_request_politely",
            label: "礼貌拒绝请求",
            type: "expression_gap",
            example: "这个周末恐怕不行",
            notes: "I'm afraid this weekend doesn't work for me.",
          },
        ],
      },
    });
    expect(text).toContain("WEAK-SPOT RETRIEVAL DRILL");
    expect(text.indexOf("grammar:article_usage")).toBeLessThan(
      text.indexOf("gap:decline_request_politely"),
    );
    expect(text).toContain("never reveal");
  });

  it("quickfire block includes the review hook and the second-chance rule", () => {
    const text = formatModifierInstructions({
      quickfire: { scenario: "airport" },
    });
    expect(text).toContain("REVIEW HOOK");
    expect(text).toContain("SECOND CHANCE");
  });
});

describe("conversationType", () => {
  const base = {
    id: "c1",
    title: "t",
    createdAt: 0,
    updatedAt: 0,
    kind: "practice" as const,
    learningAgentId: null,
    summary: null,
    summaryThroughId: null,
    parentConversationId: null,
    branchSourceTurnId: null,
    branchKind: null,
    pinned: 0,
  };

  it("recognizes the new drill modifiers", () => {
    expect(
      conversationType({
        ...base,
        agentModifiersJson: JSON.stringify({ shadowing: { theme: "x" } }),
      }),
    ).toBe("shadowing");
    expect(
      conversationType({
        ...base,
        agentModifiersJson: JSON.stringify({ reviewDrill: { items: [] } }),
      }),
    ).toBe("review_drill");
  });
});

describe("parseDictationReply", () => {
  it("splits feedback and sentence for drill turns", () => {
    const { feedback, sentence } = parseDictationReply(
      "不错,只漏了一个词。[[SAY]]The receipt is in the bag.[[/SAY]]",
    );
    expect(feedback).toBe("不错,只漏了一个词。");
    expect(sentence).toBe("The receipt is in the bag.");
  });
});
