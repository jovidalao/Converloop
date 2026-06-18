import { invoke } from "@tauri-apps/api/core";
import { parseLLMJson } from "../agents/parse-llm-json";
import type {
  PronunciationAssessment,
  PronunciationAssessor,
  PronunciationInput,
} from "./types";
import { blobToWavBase64 } from "./wav";

export interface OpenAIPronunciationConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function buildOpenAIPronunciationPrompt(input: {
  referenceText: string;
  language: string;
  nativeLanguage: string;
}): string {
  return `You are a pronunciation coach for a learner of ${input.language}.
You are given an audio recording of the learner reading/saying a target sentence, plus the target text.

TARGET TEXT (${input.language}):
${input.referenceText}

Assess ONLY how it was pronounced: individual sounds, stress, intonation, rhythm, and clarity. Judge from
the audio itself; do not rewrite grammar or re-transcribe the answer. If the audio is silent,
unintelligible, or does not match the target, say so in "notes" and return an empty "words" array.

Return ONLY JSON of this exact shape (omit optional fields you can't judge):
{
  "overall": <integer 0-100, overall intelligibility/accuracy>,
  "notes": "<one or two concrete coaching sentences, written in ${input.nativeLanguage}>",
  "words": [
    { "text": "<a word from the target the learner should practice>",
      "score": <integer 0-100>,
      "issue": "<what was off and how to fix it, in ${input.nativeLanguage}>" }
  ]
}
List in "words" ONLY the words actually worth practicing. Keep it short.`;
}

type OpenAIAudioBody = {
  model: string;
  store: boolean;
  modalities: string[];
  audio: { voice: string; format: string };
  response_format: { type: string };
  messages: {
    role: "user";
    content: (
      | { type: "text"; text: string }
      | { type: "input_audio"; input_audio: { data: string; format: string } }
    )[];
  }[];
};

export function buildOpenAIPronunciationRequestBody(
  model: string,
  prompt: string,
  audioB64: string,
): OpenAIAudioBody {
  return {
    model,
    store: false,
    // OpenAI's audio-capable Chat Completions path expects an audio model and
    // modalities/audio fields when using input_audio.
    modalities: ["text", "audio"],
    audio: { voice: "alloy", format: "wav" },
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "input_audio",
            input_audio: { data: audioB64, format: "wav" },
          },
        ],
      },
    ],
  };
}

export function openAIPronunciationUrl(cfg: OpenAIPronunciationConfig): string {
  return `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function extractOpenAIPronunciationText(raw: string): string {
  const json = JSON.parse(raw) as {
    error?: { message?: string };
    choices?: {
      message?: {
        content?: string | null;
        parsed?: unknown;
        refusal?: string | null;
        audio?: { transcript?: string | null };
      };
      text?: string;
    }[];
  };
  if (json.error?.message) throw new Error(json.error.message);
  const message = json.choices?.[0]?.message;
  if (message?.refusal) throw new Error(message.refusal);
  if (message?.parsed !== undefined && message.parsed !== null) {
    return typeof message.parsed === "string"
      ? message.parsed
      : JSON.stringify(message.parsed);
  }
  if (typeof message?.content === "string" && message.content.trim()) {
    return message.content;
  }
  if (typeof message?.audio?.transcript === "string") {
    return message.audio.transcript;
  }
  if (typeof json.choices?.[0]?.text === "string") return json.choices[0].text;
  throw new Error("OpenAI returned no pronunciation assessment.");
}

export function parseOpenAIPronunciationResponse(
  raw: string,
): PronunciationAssessment {
  const parsed = parseLLMJson(extractOpenAIPronunciationText(raw));
  if (!parsed.ok) throw new Error(parsed.error);
  const value = parsed.value as Partial<PronunciationAssessment>;
  return {
    overall: typeof value.overall === "number" ? value.overall : undefined,
    notes: typeof value.notes === "string" ? value.notes : undefined,
    words: Array.isArray(value.words) ? value.words : [],
  };
}

export function createOpenAIPronunciationAssessor(
  cfg: OpenAIPronunciationConfig,
): PronunciationAssessor {
  return {
    async assess(input: PronunciationInput): Promise<PronunciationAssessment> {
      const audioB64 = await blobToWavBase64(input.audio);
      const prompt = buildOpenAIPronunciationPrompt(input);
      const raw = await invoke<string>("llm_request", {
        url: openAIPronunciationUrl(cfg),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: buildOpenAIPronunciationRequestBody(cfg.model, prompt, audioB64),
      });
      return parseOpenAIPronunciationResponse(raw);
    },
  };
}
