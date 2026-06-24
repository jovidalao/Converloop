import { describe, expect, it } from "vitest";
import { BUILTIN_DRILL_IDS, getBuiltinDrillSeed } from "../drills/builtins";
import { renderDrillInstructions } from "../drills/render";
import {
  conversationType,
  formatModifierInstructions,
  getConversationModelOverride,
  parseAgentModifiers,
  parseDictationReply,
} from "./conversations";

function seedDef(id: string) {
  const seed = getBuiltinDrillSeed(id);
  if (!seed) throw new Error(`missing builtin drill seed ${id}`);
  return seed.def;
}

describe("renderDrillInstructions (built-in drill documents)", () => {
  it("dictation weaves in listening focus words and the replay note", () => {
    const text = renderDrillInstructions(
      seedDef(BUILTIN_DRILL_IDS.dictation),
      { setup: "travel" },
      {
        listeningFocusWords: ["receipt", "aisle"],
        replayNote: "PACING — the learner needed 3 replay(s).",
      },
    );
    expect(text).toContain("DICTATION DRILL");
    expect(text).toContain('"travel"');
    expect(text).toContain('"receipt"');
    expect(text).toContain('"aisle"');
    expect(text).toContain("PACING — the learner needed 3 replay(s).");
    // The say output contract is appended by code, never written in the document.
    expect(text).toContain("[[SAY]]");
    expect(text).toContain("[[/SAY]]");
    expect(text).toContain("NEVER write the upcoming sentence");
  });

  it("dictation omits the listening review block when there are no focus words", () => {
    const text = renderDrillInstructions(seedDef(BUILTIN_DRILL_IDS.dictation), {
      setup: "travel",
    });
    expect(text).toContain("DICTATION DRILL");
    expect(text).not.toContain("LISTENING REVIEW");
  });

  it("weak-spot drill lists items in order and forbids revealing the target", () => {
    const text = renderDrillInstructions(
      seedDef(BUILTIN_DRILL_IDS.reviewDrill),
      {
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
    );
    expect(text).toContain("WEAK-SPOT RETRIEVAL DRILL");
    expect(text.indexOf("grammar:article_usage")).toBeLessThan(
      text.indexOf("gap:decline_request_politely"),
    );
    expect(text).toContain("never reveal");
    // Chat-interaction drill: no say contract.
    expect(text).not.toContain("[[SAY]]");
  });

  it("quickfire includes the review hook and the second-chance rule", () => {
    const text = renderDrillInstructions(seedDef(BUILTIN_DRILL_IDS.quickfire), {
      setup: "airport",
    });
    expect(text).toContain("REVIEW HOOK");
    expect(text).toContain("SECOND CHANCE");
    expect(text).toContain('"airport"');
  });

  it("formats as one '- …' adjustment block with indented continuations", () => {
    const text = renderDrillInstructions(seedDef(BUILTIN_DRILL_IDS.quickfire), {
      setup: "airport",
    });
    const lines = text.split("\n");
    expect(lines[0].startsWith("- ")).toBe(true);
    expect(lines.slice(1).every((line) => line.startsWith("  "))).toBe(true);
  });
});

describe("formatModifierInstructions", () => {
  it("appends a pre-rendered drill block after the generic adjustments", () => {
    const text = formatModifierInstructions(
      { difficultyDelta: 1 },
      { drillBlock: "- DRILL BLOCK" },
    );
    expect(text).toContain("HIGHER");
    expect(text.indexOf("HIGHER")).toBeLessThan(text.indexOf("- DRILL BLOCK"));
  });
});

describe("parseAgentModifiers legacy drill normalization", () => {
  it("maps legacy quickfire/dictation/reviewDrill keys to the generic drill modifier", () => {
    const quickfire = parseAgentModifiers(
      JSON.stringify({ quickfire: { scenario: "airport" } }),
    );
    expect(quickfire.drill?.modeId).toBe(BUILTIN_DRILL_IDS.quickfire);
    expect(quickfire.drill?.params.setup).toBe("airport");
    expect(quickfire.drill?.def.interaction).toBe("chat");

    const dictation = parseAgentModifiers(
      JSON.stringify({ dictation: { theme: "travel" } }),
    );
    expect(dictation.drill?.modeId).toBe(BUILTIN_DRILL_IDS.dictation);
    expect(dictation.drill?.def.interaction).toBe("say-hidden");
    expect(dictation.drill?.def.mastery).toBe("listening");

    const review = parseAgentModifiers(
      JSON.stringify({
        reviewDrill: {
          items: [
            {
              key: "k",
              label: "l",
              type: "grammar",
              example: null,
              notes: null,
            },
          ],
        },
      }),
    );
    expect(review.drill?.modeId).toBe(BUILTIN_DRILL_IDS.reviewDrill);
    expect(review.drill?.params.items).toHaveLength(1);
    expect(review.drill?.def.mastery).toBe("review");
  });

  it("keeps non-drill modifiers intact alongside the normalized drill", () => {
    const mods = parseAgentModifiers(
      JSON.stringify({
        difficultyDelta: 1,
        quickfire: { scenario: "x" },
      }),
    );
    expect(mods.difficultyDelta).toBe(1);
    expect(mods.drill?.modeId).toBe(BUILTIN_DRILL_IDS.quickfire);
  });

  it("keeps conversation model overrides intact", () => {
    const modelOverride = {
      providerType: "codex-oauth",
      model: "gpt-5.5",
    };
    const mods = parseAgentModifiers(JSON.stringify({ modelOverride }));
    expect(mods.modelOverride).toEqual(modelOverride);
    expect(
      getConversationModelOverride({
        agentModifiersJson: JSON.stringify({ modelOverride }),
      } as Parameters<typeof getConversationModelOverride>[0]),
    ).toEqual(modelOverride);
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

  it("recognizes legacy drill modifier rows", () => {
    expect(
      conversationType({
        ...base,
        agentModifiersJson: JSON.stringify({ reviewDrill: { items: [] } }),
      }),
    ).toBe("review_drill");
  });

  it("maps generic drill rows via their interaction/setup preset", () => {
    const seed = getBuiltinDrillSeed(BUILTIN_DRILL_IDS.dictation);
    expect(
      conversationType({
        ...base,
        agentModifiersJson: JSON.stringify({
          drill: {
            modeId: "custom:abc",
            params: { setup: "x" },
            def: seed?.def,
          },
        }),
      }),
    ).toBe("dictation");
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
