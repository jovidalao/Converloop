import { describe, expect, it } from "vitest";
import { buildBody, consumeSseLines, withSchemaReminder } from "./openai";
import type { ChatMessage } from "./types";

const cfg = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "k",
  model: "deepseek-chat",
};
const schema = {
  name: "Out",
  schema: {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
  },
};
const msgs: ChatMessage[] = [
  { role: "system", content: "be helpful" },
  { role: "user", content: "hi" },
];

describe("openai json_schema fallback", () => {
  it("keeps response_format json_schema when fallback is off", () => {
    const body = buildBody(
      { ...cfg, jsonObjectFallback: false },
      {
        messages: msgs,
        jsonSchema: schema,
      },
      false,
    ) as Record<string, { type?: string }>;
    expect(body.response_format?.type).toBe("json_schema");
    // Messages are untouched.
    expect((body.messages as ChatMessage[])[0].content).toBe("be helpful");
  });

  it("degrades to json_object and injects the schema into the prompt when fallback is on", () => {
    const body = buildBody(
      { ...cfg, jsonObjectFallback: true },
      {
        messages: msgs,
        jsonSchema: schema,
      },
      false,
    ) as Record<string, unknown>;
    expect(body.response_format).toEqual({ type: "json_object" });
    const out = body.messages as ChatMessage[];
    expect(out[0].content).toContain("be helpful"); // original kept
    expect(out[0].content).toContain("JSON schema"); // reminder appended
    expect(out[0].content).toContain('"type":"object"'); // schema serialized in
  });

  it("ignores the fallback flag for plain (non-schema) requests", () => {
    const body = buildBody(
      { ...cfg, jsonObjectFallback: true },
      {
        messages: msgs,
      },
      false,
    ) as Record<string, unknown>;
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toBe(msgs); // unchanged reference
  });

  it("merges multiple system blocks into one system message for the wire format", () => {
    const body = buildBody(
      cfg,
      {
        messages: [
          { role: "system", content: "stable rules" },
          { role: "system", content: "dynamic data" },
          { role: "user", content: "hi" },
        ],
      },
      false,
    ) as Record<string, unknown>;
    expect(body.messages).toEqual([
      { role: "system", content: "stable rules\n\ndynamic data" },
      { role: "user", content: "hi" },
    ]);
  });
});

describe("withSchemaReminder", () => {
  it("appends to the first system message", () => {
    const out = withSchemaReminder(msgs, schema);
    expect(out[0].role).toBe("system");
    expect(out[0].content.startsWith("be helpful")).toBe(true);
    expect(out[1]).toEqual(msgs[1]); // other messages untouched
  });

  it("prepends a system message when there is none", () => {
    const userOnly: ChatMessage[] = [{ role: "user", content: "hi" }];
    const out = withSchemaReminder(userOnly, schema);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe("system");
    expect(out[1].content).toBe("hi");
  });
});

describe("openai stream usage", () => {
  it("reads prompt_tokens from the trailing usage chunk", () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":10}}',
      "data: [DONE]",
    ];
    const out: string[] = [];
    const r = consumeSseLines(lines, (d) => out.push(d));
    expect(out.join("")).toBe("Hi");
    expect(r.usage).toEqual({ inputTokens: 321, outputTokens: 10 });
  });

  it("leaves usage undefined when the endpoint omits a usage chunk", () => {
    const r = consumeSseLines(
      ['data: {"choices":[{"delta":{"content":"x"}}]}'],
      () => {},
    );
    expect(r.usage).toBeUndefined();
  });
});
