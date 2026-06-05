import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { generateDerivedConversation } from "./derive-conversation";

describe("generateDerivedConversation", () => {
  it("传入共享 JSON schema,并把 snake_case 输出映射成新会话上下文", async () => {
    let seen: GenerateOptions | undefined;
    const provider: ModelProvider = {
      generate: async (opts) => {
        seen = opts;
        return JSON.stringify({
          title: "Interview warmup",
          scenario: "A short interview practice.",
          user_role: "Candidate",
          ai_role: "Interviewer",
          difficulty: "B2",
          continuity_summary: "Continue from salary negotiation.",
          opening_instruction: "Ask one concise follow-up question.",
          constraints: ["Keep it spoken", "Do not mention hidden context"],
        });
      },
      stream: async () => "",
    };

    const result = await generateDerivedConversation(
      provider,
      [{ role: "system", content: "derive" }],
      { temperature: 0.2, maxTokens: 256, label: "test:derive" },
    );

    expect(result).toEqual({
      title: "Interview warmup",
      scenario: "A short interview practice.",
      userRole: "Candidate",
      aiRole: "Interviewer",
      difficulty: "B2",
      continuitySummary: "Continue from salary negotiation.",
      openingInstruction: "Ask one concise follow-up question.",
      constraints: ["Keep it spoken", "Do not mention hidden context"],
    });

    const opts = seen as GenerateOptions;
    expect(opts.temperature).toBe(0.2);
    expect(opts.maxTokens).toBe(256);
    expect(opts.meta?.label).toBe("test:derive");
    expect(opts.jsonSchema?.name).toBe("NewConversationContext");
    expect(opts.jsonSchema?.schema.$schema).toBeUndefined();
  });
});
