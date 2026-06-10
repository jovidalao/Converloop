import { describe, expect, it } from "vitest";
import { tutorJsonSchema } from "../agents/schema";
import {
  type AnthropicConfig,
  anthropicMessagesUrl,
  authHeaders,
  buildAnthropicRequestBody,
  consumeAnthropicSseLines,
  extractAnthropicContent,
  toAnthropicMessages,
} from "./anthropic";

const cfg: AnthropicConfig = {
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "test-key",
  model: "claude-sonnet-4-20250514",
};

describe("anthropic REST alignment", () => {
  it("messages URL matches official path", () => {
    expect(anthropicMessagesUrl(cfg)).toBe(
      "https://api.anthropic.com/v1/messages",
    );
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

  it("multiple system messages: stable blocks cached, dynamic tail uncached", () => {
    const { system } = toAnthropicMessages([
      { role: "system", content: "Stable rules." },
      { role: "system", content: "Slow-changing profile." },
      { role: "system", content: "Per-turn dynamic data." },
      { role: "user", content: "Hi" },
    ]);
    expect(system).toEqual([
      {
        type: "text",
        text: "Stable rules.",
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: "Slow-changing profile.",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "Per-turn dynamic data." },
    ]);
  });

  it("caps cache breakpoints at 3 system blocks", () => {
    const { system } = toAnthropicMessages([
      { role: "system", content: "a" },
      { role: "system", content: "b" },
      { role: "system", content: "c" },
      { role: "system", content: "d" },
      { role: "system", content: "e" },
      { role: "user", content: "Hi" },
    ]);
    expect(
      system?.map((block) => Boolean(block.cache_control)),
    ).toEqual([true, true, true, false, false]);
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

  it("jsonObject uses a generic JSON tool instead of being ignored", () => {
    const body = buildAnthropicRequestBody(
      cfg,
      {
        messages: [{ role: "user", content: "Return JSON." }],
        jsonObject: true,
      },
      false,
    );
    expect(body.tools).toEqual([
      {
        name: "JsonResponse",
        description: "Structured JSON object response",
        input_schema: {
          type: "object",
          additionalProperties: true,
        },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "tool", name: "JsonResponse" });
  });

  it("extractAnthropicContent reads tool_use input as JSON", () => {
    const text = extractAnthropicContent({
      content: [
        {
          type: "tool_use",
          name: "TutorAnalysis",
          input: {
            is_correct: true,
            corrected: "x",
            natural: "x",
            issues: [],
            mastery_updates: [],
          },
        },
      ],
    });
    expect(JSON.parse(text)).toMatchObject({ is_correct: true });
  });

  it("extractAnthropicContent joins text blocks", () => {
    expect(
      extractAnthropicContent({
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: " world" },
        ],
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

  it("oauth mode prepends the Claude Code identity system block", () => {
    const body = buildAnthropicRequestBody(
      { ...cfg, oauth: true },
      {
        messages: [
          { role: "system", content: "Analyze." },
          { role: "user", content: "Hi" },
        ],
      },
      false,
    );
    const system = body.system as { type: string; text: string }[];
    expect(system[0]).toEqual({
      type: "text",
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
    });
    expect(system[1].text).toBe("Analyze.");
  });

  it("oauth mode uses Bearer auth + oauth beta, drops x-api-key", () => {
    const headers = authHeaders({ ...cfg, oauth: true });
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["anthropic-beta"]).toContain("oauth-2025-04-20");
  });

  it("api-key mode keeps x-api-key and no Authorization header", () => {
    const headers = authHeaders(cfg);
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("generate options maxTokens overrides config default", () => {
    const body = buildAnthropicRequestBody(
      cfg,
      { messages: [{ role: "user", content: "x" }], maxTokens: 8192 },
      false,
    );
    expect(body.max_tokens).toBe(8192);
  });

  it("keeps temperature for models that support sampling params", () => {
    const body = buildAnthropicRequestBody(
      cfg,
      { messages: [{ role: "user", content: "x" }], temperature: 0.3 },
      false,
    );
    expect(body.temperature).toBe(0.3);
  });

  it("omits temperature for Claude Opus 4.8", () => {
    const body = buildAnthropicRequestBody(
      { ...cfg, model: "claude-opus-4-8", oauth: true },
      { messages: [{ role: "user", content: "x" }], temperature: 0.3 },
      false,
    );
    expect(body.temperature).toBeUndefined();
  });
});

describe("anthropic stream usage", () => {
  it("sums input + cache buckets and reads final output tokens", () => {
    const lines = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":50,"cache_read_input_tokens":2000,"cache_creation_input_tokens":100,"output_tokens":1}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}',
    ];
    const out: string[] = [];
    const r = consumeAnthropicSseLines(lines, (d) => out.push(d));
    expect(out.join("")).toBe("Hi");
    // 50 (uncached) + 2000 (cache read) + 100 (cache creation) = the real context size, not just the uncached tail.
    expect(r.usage).toEqual({ inputTokens: 2150, outputTokens: 12 });
  });

  it("leaves usage undefined when no usage events are present", () => {
    const r = consumeAnthropicSseLines(
      [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}',
      ],
      () => {},
    );
    expect(r.usage).toBeUndefined();
  });
});
