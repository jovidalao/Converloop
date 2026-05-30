import { getSecret } from "../keychain";

export const MIMO_TTS_KEY_ACCOUNT = "mimo_tts_api_key";

export const MIMO_TTS_DEFAULTS = {
  baseUrl: "http://192.168.31.154:8045/v1",
  model: "mimo-v2.5-tts",
  voice: "Chloe",
  stylePrompt:
    "Clear, natural pronunciation at a moderate pace. Friendly conversational tone suitable for language learning.",
};

export const MIMO_VOICES: { id: string; label: string }[] = [
  { id: "mimo_default", label: "MiMo 默认" },
  { id: "冰糖", label: "冰糖 (中文 · 女)" },
  { id: "茉莉", label: "茉莉 (中文 · 女)" },
  { id: "苏打", label: "苏打 (中文 · 男)" },
  { id: "白桦", label: "白桦 (中文 · 男)" },
  { id: "Mia", label: "Mia (English · Female)" },
  { id: "Chloe", label: "Chloe (English · Female)" },
  { id: "Milo", label: "Milo (English · Male)" },
  { id: "Dean", label: "Dean (English · Male)" },
];

export interface TtsConfig {
  baseUrl: string;
  model: string;
  voice: string;
  stylePrompt: string;
  /** 新 AI 回复边收流边自动分句朗读。 */
  autoSpeak: boolean;
}

const STORAGE_KEY = "lang-agent.tts";

const DEFAULT_TTS_CONFIG: TtsConfig = {
  baseUrl: MIMO_TTS_DEFAULTS.baseUrl,
  model: MIMO_TTS_DEFAULTS.model,
  voice: MIMO_TTS_DEFAULTS.voice,
  stylePrompt: MIMO_TTS_DEFAULTS.stylePrompt,
  autoSpeak: true,
};

export function loadTtsConfig(): TtsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TTS_CONFIG };
    return { ...DEFAULT_TTS_CONFIG, ...(JSON.parse(raw) as Partial<TtsConfig>) };
  } catch {
    return { ...DEFAULT_TTS_CONFIG };
  }
}

export function saveTtsConfig(config: TtsConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export async function getMimoTtsApiKey(): Promise<string | null> {
  return getSecret(MIMO_TTS_KEY_ACCOUNT);
}

export class MissingTtsApiKeyError extends Error {
  constructor() {
    super("请先在设置 → 朗读 中配置 MiMo API key。");
    this.name = "MissingTtsApiKeyError";
  }
}
