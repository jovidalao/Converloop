import { describe, expect, it } from "vitest";
import { tutorJsonSchema } from "../agents/schema";
import {
  anthropicMessagesUrl,
  buildAnthropicRequestBody,
  extractAnthropicContent,
  toAnthropicMessages,
  type AnthropicConfig,
} from "./anthropic";

const cfg: AnthropicConfig = {
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "test-key",
  model: "claude-sonnet-4-20250514",
};

describe("anthropic REST alignment", () => {
  it("messages URL matches official path", () => {
    expect(anthropicMessagesUrl(cfg)).toBe("https://api.anthropic.com/v1/messages");
  });

  it("system messages become cached system blocks", () => {
    const { system, messages } = toAnthropicMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ]);
    expect(system).toEqual([
      {
        type: "text",
        text: "You are helpful.",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("multi-turn maps user/assistant roles", () => {
    const { messages } = toAnthropicMessages([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Bye" },
    ]);
    expect(messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Bye" },
    ]);
  });

  it("structured output uses tools + tool_choice", () => {
    const { schema, name } = tutorJsonSchema();
    const body = buildAnthropicRequestBody(
      cfg,
      {
        messages: [
          { role: "system", content: "Analyze." },
          { role: "user", content: "I go yesterday." },
        ],
        jsonSchema: { name, schema },
      },
      false,
    );
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(false);
    expect(body.tools).toEqual([
      {
        name: "TutorAnalysis",
        description: "Structured output: TutorAnalysis",
        input_schema: schema,
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "tool", name: "TutorAnalysis" });
  });

  it("extractAnthropicContent reads tool_use input as JSON", () => {
    const text = extractAnthropicContent({
      content: [
        {
          type: "tool_use",
          name: "TutorAnalysis",
          input: { is_correct: true, corrected: "x", natural: "x", issues: [], mastery_updates: [] },
        },
      ],
    });
    expect(JSON.parse(text)).toMatchObject({ is_correct: true });
  });

  it("extractAnthropicContent joins text blocks", () => {
    expect(
      extractAnthropicContent({
        content: [{ type: "text", text: "Hello" }, { type: "text", text: " world" }],
      }),
    ).toBe("Hello world");
  });

  it("extractAnthropicContent skips thinking blocks", () => {
    expect(
      extractAnthropicContent({
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: '{"is_correct":true}' },
        ],
      }),
    ).toBe('{"is_correct":true}');
  });

  it("generate options maxTokens overrides config default", () => {
    const body = buildAnthropicRequestBody(
      cfg,
      { messages: [{ role: "user", content: "x" }], maxTokens: 8192 },
      false,
    );
    expect(body.max_tokens).toBe(8192);
  });
});
