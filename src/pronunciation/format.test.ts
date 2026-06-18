import { describe, expect, it } from "vitest";
import { formatPronunciationBody } from "./format";
import {
  buildPronunciationPrompt,
  buildPronunciationRequestBody,
  parsePronunciationResponse,
} from "./gemini";
import {
  buildOpenAIPronunciationRequestBody,
  parseOpenAIPronunciationResponse,
} from "./openai";
import type { PronunciationAssessment } from "./types";

// Wrap a JSON payload the way a Gemini generateContent response carries model text.
function geminiResponse(payload: unknown): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  });
}

describe("buildPronunciationRequestBody", () => {
  it("sends the prompt plus inline WAV audio in one user turn", () => {
    const body = buildPronunciationRequestBody("grade this", "QUJD");
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].parts).toEqual([
      { text: "grade this" },
      { inlineData: { mimeType: "audio/wav", data: "QUJD" } },
    ]);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });
});

describe("buildPronunciationPrompt", () => {
  it("embeds the target text and asks for native-language notes", () => {
    const prompt = buildPronunciationPrompt({
      referenceText: "The train leaves at noon.",
      language: "English",
      nativeLanguage: "Chinese",
    });
    expect(prompt).toContain("The train leaves at noon.");
    expect(prompt).toContain("learner of English");
    expect(prompt).toContain("written in Chinese");
  });
});

describe("parsePronunciationResponse", () => {
  it("parses a well-formed assessment", () => {
    const raw = geminiResponse({
      overall: 82,
      notes: "整体不错",
      words: [{ text: "noon", score: 60, issue: "元音偏短" }],
    });
    const a = parsePronunciationResponse(raw);
    expect(a.overall).toBe(82);
    expect(a.words[0]).toMatchObject({ text: "noon", score: 60 });
  });

  it("defaults words to [] when omitted", () => {
    const a = parsePronunciationResponse(geminiResponse({ overall: 90 }));
    expect(a.words).toEqual([]);
  });

  it("throws when the model returned no text (blocked / empty)", () => {
    const raw = JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } });
    expect(() => parsePronunciationResponse(raw)).toThrow(/SAFETY/);
  });

  it("surfaces an API error message", () => {
    const raw = JSON.stringify({ error: { message: "bad key" } });
    expect(() => parsePronunciationResponse(raw)).toThrow(/bad key/);
  });
});

describe("OpenAI pronunciation adapter helpers", () => {
  it("sends prompt plus input_audio through chat completions", () => {
    const body = buildOpenAIPronunciationRequestBody(
      "gpt-audio-1.5",
      "grade this",
      "QUJD",
    );
    expect(body.model).toBe("gpt-audio-1.5");
    expect(body.store).toBe(false);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "grade this" },
      {
        type: "input_audio",
        input_audio: { data: "QUJD", format: "wav" },
      },
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("parses text content from an OpenAI chat completion", () => {
    const raw = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              overall: 81,
              notes: "Good rhythm.",
              words: [{ text: "coffee", score: 65, issue: "stress" }],
            }),
          },
        },
      ],
    });
    expect(parseOpenAIPronunciationResponse(raw)).toMatchObject({
      overall: 81,
      words: [{ text: "coffee", score: 65 }],
    });
  });
});

describe("formatPronunciationBody", () => {
  it("renders score, notes, and only the flagged words", () => {
    const a: PronunciationAssessment = {
      overall: 78,
      notes: "再练一下结尾。",
      words: [
        { text: "leaves", score: 95 }, // said well → not listed
        { text: "noon", score: 55, issue: "拉长元音" },
      ],
    };
    const body = formatPronunciationBody(a);
    expect(body).toContain("**78 / 100**");
    expect(body).toContain("再练一下结尾。");
    expect(body).toContain("- **noon** (55) — 拉长元音");
    expect(body).not.toContain("leaves");
  });

  it("includes IPA when phonemes are present (dedicated-API path)", () => {
    const body = formatPronunciationBody({
      words: [
        { text: "thought", issue: "th", phonemes: [{ ipa: "θ", score: 40 }] },
      ],
    });
    expect(body).toContain("- **thought** /θ/ — th");
  });

  it("returns empty when there is nothing worth showing", () => {
    expect(formatPronunciationBody({ words: [] })).toBe("");
    expect(
      formatPronunciationBody({ words: [{ text: "fine", score: 99 }] }),
    ).toBe("");
  });
});
