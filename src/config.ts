import { getSecret } from "./keychain";
import { createOpenAIProvider } from "./providers/openai";
import type { ModelProvider } from "./providers/types";

// 非密配置存 localStorage;API key 存 OS keychain(见 keychain.ts)。
export interface AppConfig {
  baseUrl: string;
  model: string;
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
}

export const API_KEY_ACCOUNT = "openai_api_key";

const STORAGE_KEY = "lang-agent.config";

const DEFAULT_CONFIG: AppConfig = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
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
  const apiKey = await getSecret(API_KEY_ACCOUNT);
  if (!apiKey) return null;
  return createOpenAIProvider({
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
  });
}
