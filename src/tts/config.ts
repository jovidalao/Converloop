import { staticT } from "../i18n";
import { getSecret } from "../keychain";
import { languageToBcp47 } from "../lib/language";

export const MIMO_TTS_KEY_ACCOUNT = "mimo_tts_api_key";

export const MIMO_TTS_DEFAULTS = {
  // MiMo TTS has no canonical public endpoint; the user supplies their own
  // OpenAI-compatible gateway in Settings → Text-to-Speech.
  baseUrl: "",
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
// The default voice is the "auto" sentinel — it follows the learning language (see resolveEdgeVoice), so a
// learner of Spanish hears a Spanish voice without touching settings.
export const EDGE_AUTO_VOICE = "auto";
const EDGE_FALLBACK_VOICE = "en-US-EmmaMultilingualNeural";

export const EDGE_TTS_DEFAULTS = {
  voice: EDGE_AUTO_VOICE,
  rate: "+0%",
  pitch: "+0Hz",
};

export const EDGE_VOICES: { id: string; label: string }[] = [
  { id: EDGE_AUTO_VOICE, label: "Auto · follow learning language" },
  {
    id: "en-US-EmmaMultilingualNeural",
    label: "Emma (English · Multilingual Female)",
  },
  {
    id: "en-US-AvaMultilingualNeural",
    label: "Ava (English · Multilingual Female)",
  },
  {
    id: "en-US-AndrewMultilingualNeural",
    label: "Andrew (English · Multilingual Male)",
  },
  {
    id: "en-US-BrianMultilingualNeural",
    label: "Brian (English · Multilingual Male)",
  },
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
  { id: "es-ES-ElviraNeural", label: "Elvira (Spanish · Spain Female)" },
  { id: "es-ES-AlvaroNeural", label: "Álvaro (Spanish · Spain Male)" },
  { id: "es-MX-DaliaNeural", label: "Dalia (Spanish · Mexico Female)" },
  { id: "fr-FR-DeniseNeural", label: "Denise (French · France Female)" },
  { id: "fr-FR-HenriNeural", label: "Henri (French · France Male)" },
  { id: "de-DE-KatjaNeural", label: "Katja (German · Female)" },
  { id: "de-DE-ConradNeural", label: "Conrad (German · Male)" },
  { id: "it-IT-ElsaNeural", label: "Elsa (Italian · Female)" },
  { id: "it-IT-DiegoNeural", label: "Diego (Italian · Male)" },
  {
    id: "pt-BR-FranciscaNeural",
    label: "Francisca (Portuguese · Brazil Female)",
  },
  { id: "pt-BR-AntonioNeural", label: "Antônio (Portuguese · Brazil Male)" },
  { id: "pt-PT-RaquelNeural", label: "Raquel (Portuguese · Portugal Female)" },
  { id: "ru-RU-SvetlanaNeural", label: "Svetlana (Russian · Female)" },
  { id: "ru-RU-DmitryNeural", label: "Dmitry (Russian · Male)" },
];

// Default Edge voice per learning language (BCP-47 base tag). Used to resolve the "auto" sentinel.
const LANGUAGE_DEFAULT_EDGE_VOICE: Record<string, string> = {
  en: "en-US-EmmaMultilingualNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  ja: "ja-JP-NanamiNeural",
  ko: "ko-KR-SunHiNeural",
  es: "es-ES-ElviraNeural",
  fr: "fr-FR-DeniseNeural",
  de: "de-DE-KatjaNeural",
  it: "it-IT-ElsaNeural",
  pt: "pt-BR-FranciscaNeural",
  ru: "ru-RU-SvetlanaNeural",
};

export function defaultEdgeVoiceForLanguage(targetLanguage: string): string {
  return (
    LANGUAGE_DEFAULT_EDGE_VOICE[languageToBcp47(targetLanguage)] ??
    EDGE_FALLBACK_VOICE
  );
}

// Resolve a stored Edge voice to a concrete voice name: the "auto" sentinel follows the learning language;
// any explicit voice is used as-is. Synthesis and the cache key must both use the resolved value.
export function resolveEdgeVoice(
  voice: string,
  targetLanguage: string,
): string {
  return voice === EDGE_AUTO_VOICE
    ? defaultEdgeVoiceForLanguage(targetLanguage)
    : voice;
}

// Whether the TTS engine can voice the target language. Edge's online neural voices cover a very wide range
// of languages (well beyond the study set); MiMo only ships Chinese/English voices. Unknown custom languages
// return true (don't nag about something we can't judge).
export function ttsSupportsLanguage(
  provider: TtsProvider,
  targetLanguage: string,
): boolean {
  const tag = languageToBcp47(targetLanguage);
  if (!tag) return true;
  if (provider === "mimo") return tag === "zh" || tag === "en";
  return true;
}

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
  /** Automatically speak the tutor's more idiomatic version of the learner's sentence. */
  autoSpeakNatural: boolean;
  /** Seconds to wait between AI reply auto-speak and more-idiomatic auto-speak when both are enabled. */
  autoSpeakIntervalSeconds: number;
}

const STORAGE_KEY = "lang-agent.tts";

export const TTS_CONFIG_CHANGED_EVENT = "lang-agent:tts-config-changed";
export const DEFAULT_AUTO_SPEAK_INTERVAL_SECONDS = 3;

export function normalizeAutoSpeakIntervalSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AUTO_SPEAK_INTERVAL_SECONDS;
  }
  return Math.min(60, Math.max(0, value));
}

// Edge is the out-of-the-box default: free and keyless, so autoSpeak works on a
// fresh install. MiMo needs a key plus a user-supplied gateway URL.
const DEFAULT_TTS_CONFIG: TtsConfig = {
  ttsProvider: "edge",
  baseUrl: MIMO_TTS_DEFAULTS.baseUrl,
  model: MIMO_TTS_DEFAULTS.model,
  voice: MIMO_TTS_DEFAULTS.voice,
  stylePrompt: MIMO_TTS_DEFAULTS.stylePrompt,
  edgeVoice: EDGE_TTS_DEFAULTS.voice,
  edgeRate: EDGE_TTS_DEFAULTS.rate,
  edgePitch: EDGE_TTS_DEFAULTS.pitch,
  autoSpeak: true,
  autoSpeakNatural: false,
  autoSpeakIntervalSeconds: DEFAULT_AUTO_SPEAK_INTERVAL_SECONDS,
};

export function loadTtsConfig(): TtsConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TTS_CONFIG };
    const cfg = {
      ...DEFAULT_TTS_CONFIG,
      ...(JSON.parse(raw) as Partial<TtsConfig>),
    };
    // Migrate the former hardcoded default to the "auto" sentinel so existing installs start following the
    // learning language. English still resolves to Emma, so this only changes behavior for other targets.
    if (cfg.edgeVoice === EDGE_FALLBACK_VOICE) cfg.edgeVoice = EDGE_AUTO_VOICE;
    cfg.autoSpeakIntervalSeconds = normalizeAutoSpeakIntervalSeconds(
      cfg.autoSpeakIntervalSeconds,
    );
    return cfg;
  } catch {
    return { ...DEFAULT_TTS_CONFIG };
  }
}

export function saveTtsConfig(config: TtsConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(TTS_CONFIG_CHANGED_EVENT));
}

export async function getMimoTtsApiKey(): Promise<string | null> {
  return getSecret(MIMO_TTS_KEY_ACCOUNT);
}

export class MissingTtsApiKeyError extends Error {
  constructor() {
    super(staticT("errors.ttsNoKey"));
    this.name = "MissingTtsApiKeyError";
  }
}
