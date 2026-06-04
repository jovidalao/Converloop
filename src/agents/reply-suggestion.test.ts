import { describe, expect, it } from "vitest";
import type {
  FinishReason,
  GenerateOptions,
  ModelProvider,
} from "../providers/types";
import {
  type ReplySuggestionContext,
  suggestReplyText,
} from "./reply-suggestion";

const ctx: ReplySuggestionContext = {
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
  experiencePreferences: "",
  profileSlice: "",
  history:
    "User: I'm a bit nervous about the interview.\nPartner: That's understandable. What part worries you most?",
  source: "partner_reply",
  partnerReply:
    "That's understandable. What part worries you most: the technical questions or explaining your past projects?",
};

function stubProvider(
  calls: GenerateOptions[],
  finishReason?: FinishReason,
): ModelProvider {
  return {
    async generate() {
      throw new Error("not used");
    },
    async stream(opts, onDelta) {
      calls.push(opts);
      onDelta("I think explaining my past projects is the hardest part.");
      if (finishReason) opts.onFinish?.(finishReason);
      return "I think explaining my past projects is the hardest part.";
    },
  };
}

describe("suggestReplyText", () => {
  it("uses enough output tokens for a complete recommendation", async () => {
    const calls: GenerateOptions[] = [];

    const result = await suggestReplyText(stubProvider(calls), ctx, () => {});

    expect(result.text).toBe(
      "I think explaining my past projects is the hardest part.",
    );
    expect(calls[0]?.maxTokens).toBeGreaterThanOrEqual(800);
    expect(calls[0]?.messages[0]?.content).toContain("complete sentences");
  });

  it("returns provider finish reason for UI diagnostics", async () => {
    const calls: GenerateOptions[] = [];

    const result = await suggestReplyText(
      stubProvider(calls, {
        kind: "length",
        raw: "max_tokens",
        provider: "anthropic",
      }),
      ctx,
      () => {},
    );

    expect(result.finishReason).toEqual({
      kind: "length",
      raw: "max_tokens",
      provider: "anthropic",
    });
  });
});
