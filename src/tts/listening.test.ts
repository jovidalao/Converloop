import { describe, expect, it } from "vitest";
import type { TutorAnalysis } from "../agents/schema";
import type { ConversationMeta } from "../db/conversations";
import type { ChatTurn } from "../db/turns";
import { buildConversationItems } from "./listening";

// Minimal target-language analysis (no expression gap). `natural` defaults to `corrected`.
function analysis(
  corrected: string,
  natural: string = corrected,
): TutorAnalysis {
  return {
    is_correct: true,
    corrected,
    natural,
    issues: [],
    mastery_updates: [],
    expression_gap: null,
  };
}

function gapAnalysis(target: string): TutorAnalysis {
  return {
    is_correct: false,
    corrected: "",
    natural: "",
    issues: [],
    mastery_updates: [],
    expression_gap: {
      mastery_key: "gap:x",
      mastery_label: "x",
      original: "我想说……",
      target_expression: target,
      explanation: "",
      key_items: [],
    },
  };
}

function turn(partial: Partial<ChatTurn> & { id: string }): ChatTurn {
  return {
    userText: "",
    partnerText: undefined,
    analysis: null,
    ...partial,
  };
}

const plain = { id: "c1", agentModifiersJson: null } as ConversationMeta;

function sayDrillConv(interaction: string): ConversationMeta {
  return {
    id: "c1",
    agentModifiersJson: JSON.stringify({
      drill: { modeId: "m", params: {}, def: { interaction } },
    }),
  } as ConversationMeta;
}

describe("buildConversationItems", () => {
  it("emits the learner's idiomatic line then the AI reply, in order", () => {
    const items = buildConversationItems(plain, [
      turn({
        id: "t1",
        userText: "I has a cat",
        partnerText: "Nice, what's its name?",
        analysis: analysis("I have a cat"),
      }),
    ]);
    expect(items.map((i) => [i.side, i.text])).toEqual([
      ["user", "I have a cat"],
      ["ai", "Nice, what's its name?"],
    ]);
    expect(items[0].id).toBe("t1:user");
    expect(items[1].id).toBe("t1:ai");
  });

  it("prefers the more-natural rewrite when it differs from the correction", () => {
    const items = buildConversationItems(plain, [
      turn({
        id: "t1",
        userText: "I want eat",
        partnerText: "ok",
        analysis: analysis("I want to eat", "I'm hungry — let's grab a bite"),
      }),
    ]);
    expect(items[0].text).toBe("I'm hungry — let's grab a bite");
  });

  it("uses the idiomatic target sentence for native/mixed (expression-gap) turns", () => {
    const items = buildConversationItems(plain, [
      turn({
        id: "t1",
        userText: "我想婉拒他",
        partnerText: "Got it.",
        analysis: gapAnalysis("I'd rather not, if that's okay."),
      }),
    ]);
    expect(items.map((i) => [i.side, i.text])).toEqual([
      ["user", "I'd rather not, if that's okay."],
      ["ai", "Got it."],
    ]);
  });

  it("keeps an already-correct learner line as listening material", () => {
    const items = buildConversationItems(plain, [
      turn({
        id: "t1",
        userText: "I had a great weekend.",
        partnerText: "Glad to hear it!",
        analysis: analysis("I had a great weekend."),
      }),
    ]);
    expect(items[0]).toMatchObject({
      side: "user",
      text: "I had a great weekend.",
    });
  });

  it("skips the learner line when the turn has no analysis (e.g. AI opening)", () => {
    const items = buildConversationItems(plain, [
      turn({
        id: "t1",
        userText: "",
        partnerText: "Hi there!",
        analysis: null,
      }),
    ]);
    expect(items).toEqual([
      {
        id: "t1:ai",
        conversationId: "c1",
        turnId: "t1",
        side: "ai",
        text: "Hi there!",
      },
    ]);
  });

  it("for say drills, emits only the AI [[SAY]] sentence (not the transcription)", () => {
    const items = buildConversationItems(sayDrillConv("say-hidden"), [
      turn({
        id: "t1",
        userText: "the train leaves at noon",
        partnerText: "Great try!\n[[SAY]]The train leaves at noon.[[/SAY]]",
        analysis: analysis("The train leaves at noon."),
      }),
    ]);
    expect(items).toEqual([
      {
        id: "t1:ai",
        conversationId: "c1",
        turnId: "t1",
        side: "ai",
        text: "The train leaves at noon.",
      },
    ]);
  });

  it("treats chat-interaction drills (quickfire) like normal conversations", () => {
    const items = buildConversationItems(sayDrillConv("chat"), [
      turn({
        id: "t1",
        userText: "I go store",
        partnerText: "Where exactly?",
        analysis: analysis("I'm going to the store"),
      }),
    ]);
    expect(items.map((i) => i.side)).toEqual(["user", "ai"]);
  });
});
