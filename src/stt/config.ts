import { staticT } from "../i18n";
import { getSecret } from "../keychain";

// Voice input (speech-to-text). BYOK, same trust model as the LLM providers.
// Two engines:
//  - soniox: Soniox async STT (api.soniox.com, upload → job → poll). First-class.
//  - openai: any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq,
//    local whisper servers…).
// Each engine has its own encrypted key account so switching never loses keys,
// and the STT vendor can differ from the chat provider.
export type SttProvider = "soniox" | "openai";

export const SONIOX_STT_KEY_ACCOUNT = "soniox_stt_api_key";
export const OPENAI_STT_KEY_ACCOUNT = "stt_api_key";

export function sttKeyAccount(provider: SttProvider): string {
  return provider === "soniox"
    ? SONIOX_STT_KEY_ACCOUNT
    : OPENAI_STT_KEY_ACCOUNT;
}

export interface SttConfig {
  sttProvider: SttProvider;
  // —— Soniox ——
  /** Soniox async STT model. */
  sonioxModel: string;
  // —— OpenAI-compatible ——
  baseUrl: string;
  model: string;
}

const STORAGE_KEY = "lang-agent.stt";

const DEFAULT_STT_CONFIG: SttConfig = {
  sttProvider: "soniox",
  sonioxModel: "stt-async-v4",
  baseUrl: "https://api.openai.com/v1",
  model: "whisper-1",
};

export function loadSttConfig(): SttConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STT_CONFIG };
    return {
      ...DEFAULT_STT_CONFIG,
      ...(JSON.parse(raw) as Partial<SttConfig>),
    };
  } catch {
    return { ...DEFAULT_STT_CONFIG };
  }
}

export function saveSttConfig(config: SttConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export async function getSttApiKey(
  provider: SttProvider,
): Promise<string | null> {
  return getSecret(sttKeyAccount(provider));
}

// ISO-639-1 hints for Soniox language_hints, derived from the study-language
// names in app config (the learner speaks either the target or their native
// language — hinting both keeps mixed input accurate).
const LANGUAGE_HINTS: Record<string, string> = {
  Chinese: "zh",
  English: "en",
  Japanese: "ja",
  Korean: "ko",
  Spanish: "es",
  French: "fr",
  German: "de",
  Portuguese: "pt",
  Russian: "ru",
  Italian: "it",
};

export function languageHintsFor(languages: string[]): string[] {
  return [
    ...new Set(
      languages
        .map((name) => LANGUAGE_HINTS[name])
        .filter((code): code is string => !!code),
    ),
  ];
}

export class MissingSttApiKeyError extends Error {
  constructor() {
    super(staticT("errors.sttNoKey"));
    this.name = "MissingSttApiKeyError";
  }
}
