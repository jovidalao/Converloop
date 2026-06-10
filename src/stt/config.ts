import { staticT } from "../i18n";
import { getSecret } from "../keychain";

// Voice input (speech-to-text). BYOK, same trust model as the LLM providers.
// Four engines:
//  - soniox: Soniox real-time WebSocket STT (stt-rt.soniox.com), streaming
//    partial text while speaking. First-class.
//  - openai: any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq,
//    local whisper servers…), batch record-then-upload.
//  - parakeet: NVIDIA Parakeet TDT 0.6B V3, runs fully on-device via sherpa-onnx
//    (no key, no network after download). Batch only — no streaming. 25 European
//    languages, NO Chinese/Japanese/Korean. See stt/local.ts + src-tauri/stt_local.rs.
//  - qwen3: Qwen3-ASR 0.6B int8, same on-device sherpa-onnx path as parakeet.
//    Batch only. 30+ languages including Chinese/Cantonese — the local CJK pick.
// The key-based engines each have their own encrypted key account so switching
// never loses keys; the local engines have no key. sttProvider can also be null:
// voice input then stays disabled until the user chooses one of these engines.
export const STT_PROVIDERS = ["soniox", "openai", "parakeet", "qwen3"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];
export type CloudSttProvider = Extract<SttProvider, "soniox" | "openai">;

export const SONIOX_STT_KEY_ACCOUNT = "soniox_stt_api_key";
export const OPENAI_STT_KEY_ACCOUNT = "stt_api_key";
export const STT_CONFIG_CHANGED_EVENT = "lang-agent:stt-config-changed";

function isSttProvider(value: unknown): value is SttProvider {
  return STT_PROVIDERS.includes(value as SttProvider);
}

export function sttKeyAccount(provider: CloudSttProvider): string {
  return provider === "soniox"
    ? SONIOX_STT_KEY_ACCOUNT
    : OPENAI_STT_KEY_ACCOUNT;
}

export interface SttConfig {
  sttProvider: SttProvider | null;
  // —— Soniox ——
  /** Soniox real-time (streaming) STT model. */
  sonioxModel: string;
  // —— OpenAI-compatible ——
  baseUrl: string;
  model: string;
}

const STORAGE_KEY = "lang-agent.stt";

const DEFAULT_STT_CONFIG: SttConfig = {
  sttProvider: null,
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
    const next = { ...DEFAULT_STT_CONFIG, ...stored };
    if (!isSttProvider(next.sttProvider)) next.sttProvider = null;
    return next;
  } catch {
    return { ...DEFAULT_STT_CONFIG };
  }
}

export function saveSttConfig(config: SttConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(STT_CONFIG_CHANGED_EVENT));
}

export async function getSttApiKey(
  provider: CloudSttProvider,
): Promise<string | null> {
  return getSecret(sttKeyAccount(provider));
}

export class MissingSttProviderError extends Error {
  constructor() {
    super(staticT("errors.sttNoProvider"));
    this.name = "MissingSttProviderError";
  }
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
