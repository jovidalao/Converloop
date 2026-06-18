import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { parseLLMJson } from "../agents/parse-llm-json";
import type {
  PronunciationAssessment,
  PronunciationAssessor,
  PronunciationInput,
} from "./types";
import { blobToWavBase64 } from "./wav";

// Multimodal-audio pronunciation adapter. HTTP goes through Rust's generic llm_request (same path the
// Gemini text adapter uses), so this stays parallel to the STT providers and never touches the text
// ModelProvider abstraction (whose ChatMessage.content is string-only — no audio channel). The output
// shape is requested via JSON mode (responseMimeType) + an explicit shape in the prompt, then validated
// here; we don't reuse the text adapter's responseSchema path to keep this adapter self-contained.

export interface GeminiPronunciationConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const PronunciationWordSchema = z.object({
  text: z.string(),
  score: z.number().optional(),
  issue: z.string().optional(),
  phonemes: z
    .array(z.object({ ipa: z.string(), score: z.number() }))
    .optional(),
});

export const PronunciationAssessmentSchema = z.object({
  overall: z.number().optional(),
  notes: z.string().optional(),
  words: z.array(PronunciationWordSchema).default([]),
});

/** Prompt for the assessment. Pure + exported so the contract is unit-testable. */
export function buildPronunciationPrompt(input: {
  referenceText: string;
  language: string;
  nativeLanguage: string;
}): string {
  return `You are a pronunciation coach for a learner of ${input.language}.
You are given an audio recording of the learner reading/saying a target sentence, plus the target text.

TARGET TEXT (${input.language}):
${input.referenceText}

Assess ONLY how it was pronounced — the accuracy of individual sounds plus the prosodic features that
actually matter for ${input.language} (for example: tones for Mandarin/Cantonese; pitch accent and vowel
length for Japanese; word stress and linking for English/Spanish/Russian; liaison and nasal vowels for
French; final-consonant rules for Korean). Judge from the audio itself; do not re-transcribe or correct
grammar. If the audio is silent, unintelligible, or does not match the target, say so in "notes" and return
an empty "words" array.

Return ONLY JSON of this exact shape (omit optional fields you can't judge):
{
  "overall": <integer 0-100, overall intelligibility/accuracy>,
  "notes": "<one or two sentences of encouraging, concrete coaching, written in ${input.nativeLanguage}>",
  "words": [
    { "text": "<a word from the target the learner mispronounced>",
      "score": <integer 0-100>,
      "issue": "<what was off and how to fix it, in ${input.nativeLanguage}>" }
  ]
}
List in "words" ONLY the words actually worth practicing (skip the ones said well). Keep it short.`;
}

type GeminiBody = {
  contents: {
    parts: (
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    )[];
  }[];
  generationConfig: { temperature: number; responseMimeType: string };
};

/** Build the generateContent body (text prompt + inline audio). Pure + exported for tests. */
export function buildPronunciationRequestBody(
  prompt: string,
  audioB64: string,
): GeminiBody {
  return {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "audio/wav", data: audioB64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };
}

export function pronunciationUrl(cfg: GeminiPronunciationConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/models/${cfg.model}:generateContent`;
}

// Pull the model's text out of a generateContent response, surfacing errors/blocks the same way the
// Gemini text adapter does (a 200 with no text is a silent failure otherwise).
function extractText(raw: string): string {
  const json = JSON.parse(raw) as {
    error?: { message?: string };
    candidates?: {
      content?: { parts?: { text?: string }[] };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
  };
  if (json.error?.message) throw new Error(json.error.message);
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  if (!text) {
    const reason =
      json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned no pronunciation assessment${reason ? ` (${reason})` : ""}.`,
    );
  }
  return text;
}

/** Validate the model's JSON into a PronunciationAssessment. Pure + exported for tests. */
export function parsePronunciationResponse(
  raw: string,
): PronunciationAssessment {
  const text = extractText(raw);
  const parsed = parseLLMJson(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = PronunciationAssessmentSchema.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(
      `Pronunciation assessment validation failed: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return validated.data;
}

export function createGeminiPronunciationAssessor(
  cfg: GeminiPronunciationConfig,
): PronunciationAssessor {
  return {
    async assess(input: PronunciationInput): Promise<PronunciationAssessment> {
      const audioB64 = await blobToWavBase64(input.audio);
      const prompt = buildPronunciationPrompt(input);
      const raw = await invoke<string>("llm_request", {
        url: pronunciationUrl(cfg),
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        body: buildPronunciationRequestBody(prompt, audioB64),
      });
      return parsePronunciationResponse(raw);
    },
  };
}
