import { staticT } from "../i18n";

// Pronunciation feedback (BYOK, same trust model as the LLM providers). These are assessment
// adapters, not the main chat provider: each one reuses that provider's existing key/base URL,
// but keeps a separate model choice because an audio-capable model is required here.
export const PRONUNCIATION_PROVIDERS = ["gemini", "openai"] as const;
export type PronunciationProvider = (typeof PRONUNCIATION_PROVIDERS)[number];

export interface PronunciationModelOption {
  label: string;
  model: string;
}

export const PRONUNCIATION_PROVIDER_PRESETS: Record<
  PronunciationProvider,
  {
    label: string;
    shortLabel: string;
    model: string;
    models: PronunciationModelOption[];
  }
> = {
  gemini: {
    label: "Gemini",
    shortLabel: "Gemini",
    model: "gemini-3.5-flash",
    models: [
      { label: "Gemini 3.5 Flash", model: "gemini-3.5-flash" },
      { label: "Gemini 3.1 Pro Preview", model: "gemini-3.1-pro-preview" },
      { label: "Gemini 3.1 Flash-Lite", model: "gemini-3.1-flash-lite" },
      { label: "Gemini 2.5 Pro", model: "gemini-2.5-pro" },
      { label: "Gemini 2.5 Flash", model: "gemini-2.5-flash" },
    ],
  },
  openai: {
    label: "OpenAI-compatible audio",
    shortLabel: "OpenAI Audio",
    model: "gpt-audio-1.5",
    models: [{ label: "GPT Audio 1.5", model: "gpt-audio-1.5" }],
  },
};

export const PRONUNCIATION_CONFIG_CHANGED_EVENT =
  "lang-agent:pronunciation-config-changed";

export interface PronunciationConfig {
  /** null = off (the pronunciation observer is a no-op and no audio is retained). */
  provider: PronunciationProvider | null;
  /** Per-assessor model choice. Each selected model must accept audio input. */
  models: Record<PronunciationProvider, string>;
}

const STORAGE_KEY = "lang-agent.pronunciation";

const DEFAULT_CONFIG: PronunciationConfig = {
  provider: null,
  models: {
    gemini: PRONUNCIATION_PROVIDER_PRESETS.gemini.model,
    openai: PRONUNCIATION_PROVIDER_PRESETS.openai.model,
  },
};

function freshDefault(): PronunciationConfig {
  return {
    provider: DEFAULT_CONFIG.provider,
    models: { ...DEFAULT_CONFIG.models },
  };
}

function isProvider(value: unknown): value is PronunciationProvider {
  return PRONUNCIATION_PROVIDERS.includes(value as PronunciationProvider);
}

export function loadPronunciationConfig(): PronunciationConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefault();
    const stored = JSON.parse(raw) as Partial<PronunciationConfig>;
    const next: PronunciationConfig = {
      provider: isProvider(stored.provider) ? stored.provider : null,
      models: { ...DEFAULT_CONFIG.models },
    };
    const storedModels: Partial<Record<PronunciationProvider, unknown>> =
      stored.models && typeof stored.models === "object" ? stored.models : {};
    for (const provider of PRONUNCIATION_PROVIDERS) {
      const model = storedModels[provider];
      if (typeof model === "string" && model.trim()) {
        next.models[provider] = model;
      }
    }
    // Legacy migration: v1 stored a single Gemini-only `model` field.
    const legacyModel = (stored as { model?: unknown }).model;
    if (typeof legacyModel === "string" && legacyModel.trim()) {
      next.models.gemini = legacyModel;
    }
    if (!isProvider(next.provider)) next.provider = null;
    return next;
  } catch {
    return freshDefault();
  }
}

export function savePronunciationConfig(config: PronunciationConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(PRONUNCIATION_CONFIG_CHANGED_EVENT));
}

/** Cheap gate used on the hot path (MicButton, the observer) to skip all work when the feature is off. */
export function isPronunciationEnabled(): boolean {
  return loadPronunciationConfig().provider !== null;
}

export class MissingPronunciationKeyError extends Error {
  constructor(provider: PronunciationProvider) {
    super(
      staticT("errors.pronunciationNoKey", {
        provider: PRONUNCIATION_PROVIDER_PRESETS[provider].shortLabel,
      }),
    );
    this.name = "MissingPronunciationKeyError";
  }
}
