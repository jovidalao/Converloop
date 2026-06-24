import { describe, expect, it } from "vitest";
import { buildBody, type OpenAICodexConfig } from "./openai-responses";
import type { ChatMessage } from "./types";

const cfg: OpenAICodexConfig = {
  baseUrl: "https://chatgpt.com/backend-api",
  apiKey: "token",
  model: "gpt-5.5",
};

describe("openai codex responses request body", () => {
  it("omits tuning parameters because the ChatGPT Codex backend rejects them", () => {
    const body = buildBody(cfg, {
      messages: [{ role: "user", content: "Reply with pong" }],
      temperature: 0,
      maxTokens: 64,
    });

    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_output_tokens");
  });

  it("maps assistant history to output_text content blocks", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Again" },
    ];

    const body = buildBody(cfg, { messages });

    expect(body.instructions).toBe("Be concise.");
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hi" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Again" }],
      },
    ]);
  });
});
