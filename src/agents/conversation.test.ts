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
