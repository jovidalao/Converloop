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

// 免费微软 Edge「朗读」:无 API key,合成走 Rust WebSocket(edge_tts_synthesize)。
export const EDGE_TTS_DEFAULTS = {
  voice: "en-US-EmmaMultilingualNeural",
  rate: "+0%",
  pitch: "+0Hz",
};

export const EDGE_VOICES: { id: string; label: string }[] = [
  { id: "en-US-EmmaMultilingualNeural", label: "Emma (English · 多语女)" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava (English · 多语女)" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew (English · 多语男)" },
  { id: "en-US-BrianMultilingualNeural", label: "Brian (English · 多语男)" },
  { id: "en-US-AriaNeural", label: "Aria (English · 美式女)" },
  { id: "en-US-GuyNeural", label: "Guy (English · 美式男)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (English · 英式女)" },
  { id: "en-GB-RyanNeural", label: "Ryan (English · 英式男)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (English · 澳式女)" },
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 (中文 · 女)" },
  { id: "zh-CN-YunxiNeural", label: "云希 (中文 · 男)" },
  { id: "zh-CN-YunyangNeural", label: "云扬 (中文 · 男)" },
  { id: "ja-JP-NanamiNeural", label: "Nanami (日本語 · 女)" },
  { id: "ko-KR-SunHiNeural", label: "SunHi (한국어 · 女)" },
];

export type TtsProvider = "mimo" | "edge";

export interface TtsConfig {
  /** 朗读引擎:mimo(需 key)/ edge(免费,无 key)。 */
  ttsProvider: TtsProvider;
  // —— MiMo ——
  baseUrl: string;
  model: string;
  voice: string;
  stylePrompt: string;
  // —— Edge(免费)——
  edgeVoice: string;
  /** 语速,如 "+0%" / "-20%" / "+25%"。 */
  edgeRate: string;
  /** 音高,如 "+0Hz" / "-5Hz"。 */
  edgePitch: string;
  /** 新 AI 回复边收流边自动分句朗读。 */
  autoSpeak: boolean;
}

const STORAGE_KEY = "lang-agent.tts";

const DEFAULT_TTS_CONFIG: TtsConfig = {
  ttsProvider: "mimo",
  baseUrl: MIMO_TTS_DEFAULTS.baseUrl,
  model: MIMO_TTS_DEFAULTS.model,
  voice: MIMO_TTS_DEFAULTS.voice,
  stylePrompt: MIMO_TTS_DEFAULTS.stylePrompt,
  edgeVoice: EDGE_TTS_DEFAULTS.voice,
  edgeRate: EDGE_TTS_DEFAULTS.rate,
  edgePitch: EDGE_TTS_DEFAULTS.pitch,
  autoSpeak: true,
};

export function loadTtsConfig(): TtsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TTS_CONFIG };
    return {
      ...DEFAULT_TTS_CONFIG,
      ...(JSON.parse(raw) as Partial<TtsConfig>),
    };
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
