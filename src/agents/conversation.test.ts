import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { type ConversationContext, converse } from "./conversation";

function streamProvider(calls: GenerateOptions[]): ModelProvider {
  return {
    async generate() {
      throw new Error("not used");
    },
    async stream(opts, onDelta) {
      calls.push(opts);
      onDelta("ok");
      return "ok";
    },
  };
}

const baseCtx: ConversationContext = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
  profileSlice: "The learner likes hiking.",
  experiencePreferences: "",
  comfortableItems: [],
  reviewItems: [],
  calibrationHint: "",
  sessionAdjustments: "",
  summary: "Earlier they were planning a trip to Kyoto.",
  historyTurns: [
    {
      user: "Let's talk about travel plans.",
      reply: "Sure, what part of the trip feels most exciting?",
    },
  ],
  userInput: "What does 'gist' mean?",
};

describe("converse", () => {
  it("splits the system prompt into stable-first blocks for prefix caching", async () => {
    const calls: GenerateOptions[] = [];
    await converse(
      streamProvider(calls),
      {
        ...baseCtx,
        calibrationHint: "Accuracy is trending up.",
        sessionAdjustments: "Increase difficulty slightly.",
      },
      () => {},
    );

    const system = calls[0].messages.filter((m) => m.role === "system");
    expect(system).toHaveLength(3);
    // Block 1: stable rules only (no per-learner or per-turn data).
    expect(system[0].content).toContain("conversation partner");
    expect(system[0].content).not.toContain("hiking");
    expect(system[0].content).not.toContain("Kyoto");
    // Block 2: slow-changing learner context (preferences + profile).
    expect(system[1].content).toContain("LEARNER PROFILE");
    expect(system[1].content).toContain("hiking");
    // Block 3: per-turn dynamic data (calibration, lists, adjustments, summary).
    expect(system[2].content).toContain("Accuracy is trending up.");
    expect(system[2].content).toContain("DUE FOR REVIEW");
    expect(system[2].content).toContain("SESSION ADJUSTMENTS");
    expect(system[2].content).toContain("Kyoto");
    // History rides along as real alternating messages after the system blocks.
    expect(calls[0].messages[3]).toEqual({
      role: "user",
      content: "Let's talk about travel plans.",
    });
  });

  it("adds the [[HINT]] trailer instruction only when requested", async () => {
    const withTrailer: GenerateOptions[] = [];
    await converse(
      streamProvider(withTrailer),
      { ...baseCtx, includeHintTrailer: true },
      () => {},
    );
    const stable = withTrailer[0].messages[0].content;
    expect(stable).toContain("[[HINT]]");
    expect(stable).toContain("PRIVATE HINT TRAILER");

    const without: GenerateOptions[] = [];
    await converse(streamProvider(without), baseCtx, () => {});
    expect(without[0].messages.map((m) => m.content).join("\n")).not.toContain(
      "[[HINT]]",
    );
  });

  it("weaves due review items into the per-turn dynamic data block", async () => {
    const calls: GenerateOptions[] = [];
    await converse(
      streamProvider(calls),
      {
        ...baseCtx,
        reviewItems: [
          {
            key: "grammar:article_usage",
            label: "article usage",
            type: "grammar",
            status: "struggling",
            example: "I saw a elephant at the zoo.",
            notes: null,
            retention: 0.4,
            dueScore: 0.9,
          },
        ],
      },
      () => {},
    );

    const system = calls[0].messages.filter((m) => m.role === "system");
    expect(system[2].content).toContain("article usage");
    expect(system[2].content).toContain("I saw a elephant at the zoo.");
  });

  it("answers /btw standalone questions without conversation history", async () => {
    const calls: GenerateOptions[] = [];
    const reply = await converse(
      streamProvider(calls),
      { ...baseCtx, standaloneQuestion: true },
      () => {},
    );

    expect(reply).toBe("ok");
    expect(calls).toHaveLength(1);
    const messages = calls[0].messages;
    expect(messages.map((m) => m.content).join("\n")).not.toContain("Kyoto");
    expect(messages.map((m) => m.content).join("\n")).not.toContain(
      "travel plans",
    );
    expect(messages[0].content).toContain("standalone side question");
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "What does 'gist' mean?",
    });
  });
});
