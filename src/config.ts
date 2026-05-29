import { getSecret } from "./keychain";
import { createOpenAIProvider } from "./providers/openai";
import { createGeminiProvider } from "./providers/gemini";
import type { ModelProvider } from "./providers/types";

export type ProviderType = "openai" | "gemini";

// 非密配置存 localStorage;API key 存 OS keychain(见 keychain.ts)。
export interface AppConfig {
  providerType: ProviderType;
  baseUrl: string;
  model: string;
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
}

// 每个 provider 的 key 单独存,切换不丢另一个。
export function apiKeyAccount(type: ProviderType): string {
  return `${type}_api_key`;
}

// 切换 provider 时给设置页用的预设(baseUrl + 示例模型)。
export const PROVIDER_PRESETS: Record<
  ProviderType,
  { label: string; baseUrl: string; model: string }
> = {
  openai: {
    label: "OpenAI 兼容(OpenAI / OpenRouter / LM Studio)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  gemini: {
    label: "Gemini(原生)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
  },
};

const STORAGE_KEY = "lang-agent.config";

const DEFAULT_CONFIG: AppConfig = {
  providerType: "openai",
  baseUrl: PROVIDER_PRESETS.openai.baseUrl,
  model: PROVIDER_PRESETS.openai.model,
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// 从配置 + keychain 组装 provider。无 key 时返回 null,调用方据此提示去设置页填 key。
export async function getProvider(): Promise<ModelProvider | null> {
  const config = loadConfig();
  const apiKey = await getSecret(apiKeyAccount(config.providerType));
  if (!apiKey) return null;
  if (config.providerType === "gemini") {
    return createGeminiProvider({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
    });
  }
  return createOpenAIProvider({
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
  });
}
