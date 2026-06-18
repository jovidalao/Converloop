import { apiKeyAccount, loadConfig } from "../config";
import { getSecret } from "../keychain";
import {
  loadPronunciationConfig,
  MissingPronunciationKeyError,
} from "./config";
import { createGeminiPronunciationAssessor } from "./gemini";
import { createOpenAIPronunciationAssessor } from "./openai";
import type { PronunciationAssessment, PronunciationInput } from "./types";

export type {
  PronunciationAssessment,
  PronunciationInput,
  PronunciationWord,
} from "./types";

// Single entry point: pick the configured backend behind the PronunciationAssessor interface. The Gemini
// adapter reuses the main Gemini provider's key + base URL so the learner configures one Gemini key, not two.
export async function assessPronunciation(
  input: PronunciationInput,
): Promise<PronunciationAssessment> {
  const pronCfg = loadPronunciationConfig();
  if (!pronCfg.provider) {
    throw new Error("Pronunciation feedback is disabled.");
  }
  const appCfg = loadConfig();
  const apiKey = await getSecret(apiKeyAccount(pronCfg.provider));
  if (!apiKey) throw new MissingPronunciationKeyError(pronCfg.provider);
  const entry = appCfg.providers[pronCfg.provider];
  const model = pronCfg.models[pronCfg.provider];
  const assessor =
    pronCfg.provider === "gemini"
      ? createGeminiPronunciationAssessor({
          baseUrl: entry.baseUrl,
          apiKey,
          model,
        })
      : createOpenAIPronunciationAssessor({
          baseUrl: entry.baseUrl,
          apiKey,
          model,
        });
  return assessor.assess(input);
}
