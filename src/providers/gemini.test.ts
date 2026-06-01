import { describe, expect, it } from "vitest";
import { tutorJsonSchema } from "../agents/schema";
import {
  buildGeminiRequestBody,
  type GeminiConfig,
  geminiGenerateUrl,
  geminiStreamUrl,
} from "./gemini";

const cfg: GeminiConfig = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  apiKey: "test-key",
  model: "gemini-2.0-flash",
};

describe("gemini REST alignment", () => {
  it("generate URL matches official path", () => {
    expect(geminiGenerateUrl(cfg)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
  });

  it("stream URL uses streamGenerateContent with alt=sse", () => {
    expect(geminiStreamUrl(cfg)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
  });

  it("single-turn body matches official minimal shape", () => {
    const body = buildGeminiRequestBody({
      messages: [
        { role: "user", content: "Explain how AI works in a few words" },
      ],
    });
    expect(body).toEqual({
      contents: [
        {
          parts: [{ text: "Explain how AI works in a few words" }],
        },
      ],
    });
  });

  it("multi-turn adds explicit user/model roles", () => {
    const body = buildGeminiRequestBody({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Bye" },
      ],
    });
    expect(body.contents).toEqual([
      { parts: [{ text: "Hi" }] },
      { role: "model", parts: [{ text: "Hello" }] },
      { role: "user", parts: [{ text: "Bye" }] },
    ]);
  });

  it("system messages become systemInstruction", () => {
    const body = buildGeminiRequestBody({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "You are helpful." }],
    });
    expect(body.contents).toEqual([{ parts: [{ text: "Hi" }] }]);
  });

  it("structured output uses generationConfig.responseSchema with uppercase types", () => {
    const { schema } = tutorJsonSchema();
    const body = buildGeminiRequestBody({
      messages: [{ role: "user", content: "analyze" }],
      jsonSchema: { name: "TutorAnalysis", schema },
    });
    const gen = body.generationConfig as Record<string, unknown>;
    expect(gen.responseMimeType).toBe("application/json");
    const root = gen.responseSchema as Record<string, unknown>;
    expect(root.type).toBe("OBJECT");
    expect(root).not.toHaveProperty("additionalProperties");
    expect(root).not.toHaveProperty("$schema");
    const props = root.properties as Record<string, unknown>;
    expect(props.expression_gap).toMatchObject({
      type: "OBJECT",
      nullable: true,
    });
  });

  it("temperature only adds generationConfig when set", () => {
    const body = buildGeminiRequestBody({
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.3,
    });
    expect(body.generationConfig).toEqual({ temperature: 0.3 });
  });

  it("json_object mode sets responseMimeType without schema", () => {
    const body = buildGeminiRequestBody({
      messages: [{ role: "user", content: "Hi" }],
      jsonObject: true,
    });
    expect(body.generationConfig).toEqual({
      responseMimeType: "application/json",
    });
  });
});
