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
  { id: "mimo_default", label: "MiMo default" },
  { id: "冰糖", label: "冰糖 (Chinese · Female)" },
  { id: "茉莉", label: "茉莉 (Chinese · Female)" },
  { id: "苏打", label: "苏打 (Chinese · Male)" },
  { id: "白桦", label: "白桦 (Chinese · Male)" },
  { id: "Mia", label: "Mia (English · Female)" },
  { id: "Chloe", label: "Chloe (English · Female)" },
  { id: "Milo", label: "Milo (English · Male)" },
  { id: "Dean", label: "Dean (English · Male)" },
];

// Free Microsoft Edge "Read Aloud": no API key; synthesis goes through the Rust WebSocket (edge_tts_synthesize).
export const EDGE_TTS_DEFAULTS = {
  voice: "en-US-EmmaMultilingualNeural",
  rate: "+0%",
  pitch: "+0Hz",
};

export const EDGE_VOICES: { id: string; label: string }[] = [
  { id: "en-US-EmmaMultilingualNeural", label: "Emma (English · Multilingual Female)" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava (English · Multilingual Female)" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew (English · Multilingual Male)" },
  { id: "en-US-BrianMultilingualNeural", label: "Brian (English · Multilingual Male)" },
  { id: "en-US-AriaNeural", label: "Aria (English · US Female)" },
  { id: "en-US-GuyNeural", label: "Guy (English · US Male)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (English · UK Female)" },
  { id: "en-GB-RyanNeural", label: "Ryan (English · UK Male)" },
  { id: "en-AU-NatashaNeural", label: "Natasha (English · AU Female)" },
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 (Chinese · Female)" },
  { id: "zh-CN-YunxiNeural", label: "云希 (Chinese · Male)" },
  { id: "zh-CN-YunyangNeural", label: "云扬 (Chinese · Male)" },
  { id: "ja-JP-NanamiNeural", label: "Nanami (Japanese · Female)" },
  { id: "ko-KR-SunHiNeural", label: "SunHi (Korean · Female)" },
];

export type TtsProvider = "mimo" | "edge";

export interface TtsConfig {
  /** TTS engine: mimo (requires key) / edge (free, no key). */
  ttsProvider: TtsProvider;
  // —— MiMo ——
  baseUrl: string;
  model: string;
  voice: string;
  stylePrompt: string;
  // —— Edge (free) ——
  edgeVoice: string;
  /** Playback speed, e.g. "+0%" / "-20%" / "+25%". */
  edgeRate: string;
  /** Pitch, e.g. "+0Hz" / "-5Hz". */
  edgePitch: string;
  /** Automatically speak new AI replies as they stream in, sentence by sentence. */
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
    super("Please configure the MiMo API key in Settings → Text-to-Speech first.");
    this.name = "MissingTtsApiKeyError";
  }
}
