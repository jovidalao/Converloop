import { staticT } from "../i18n";
import { getSecret } from "../keychain";

// Voice input (speech-to-text). BYOK, same trust model as the LLM providers.
// Three engines:
//  - soniox: Soniox real-time WebSocket STT (stt-rt.soniox.com), streaming
//    partial text while speaking. First-class.
//  - openai: any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq,
//    local whisper servers…), batch record-then-upload.
//  - parakeet: NVIDIA Parakeet TDT 0.6B V3, runs fully on-device via sherpa-onnx
//    (no key, no network after download). Batch only — no streaming. 25 European
//    languages, NO Chinese/Japanese/Korean. See stt/local.ts + src-tauri/stt_local.rs.
// The key-based engines each have their own encrypted key account so switching
// never loses keys; parakeet has no key (local).
export type SttProvider = "soniox" | "openai" | "parakeet";

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
  /** Soniox real-time (streaming) STT model. */
  sonioxModel: string;
  // —— OpenAI-compatible ——
  baseUrl: string;
  model: string;
}

const STORAGE_KEY = "lang-agent.stt";

const DEFAULT_STT_CONFIG: SttConfig = {
  sttProvider: "soniox",
  sonioxModel: "stt-rt-v3",
  baseUrl: "https://api.openai.com/v1",
  model: "whisper-1",
};

export function loadSttConfig(): SttConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STT_CONFIG };
    const stored = JSON.parse(raw) as Partial<SttConfig>;
    // 迁移:旧版本存的是异步模型(stt-async-*),流式接口只接受 rt 模型。
    if (stored.sonioxModel?.startsWith("stt-async")) delete stored.sonioxModel;
    return { ...DEFAULT_STT_CONFIG, ...stored };
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
