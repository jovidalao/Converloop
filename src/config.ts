import { useSyncExternalStore } from "react";
import { z } from "zod";
import { getSecret } from "./keychain";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAIProvider } from "./providers/openai";
import { defaultPlugins, withPlugins } from "./providers/plugins";
import type { ModelProvider } from "./providers/types";

export type ProviderType = "openai" | "gemini" | "anthropic";

// 非密配置存 localStorage;API key 走设备绑定加密文件(见 keychain.ts → Rust secrets.rs)。
const AppConfigSchema = z.object({
  providerType: z.enum(["openai", "gemini", "anthropic"]),
  baseUrl: z.string(),
  model: z.string(),
  nativeLanguage: z.string(),
  targetLanguage: z.string(),
  level: z.string(),
  /** 新 AI 回复自动展开双语对照。 */
  autoBilingual: z.boolean(),
  /** 手动覆盖模型上下文窗口(token)。留空则按 model 名查表猜测(见 getContextLimit)。 */
  contextTokens: z.number().int().positive().optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// 已知模型的上下文窗口(token),按 model 名前缀匹配。BYOK 下 model 是自由串,命中不了
// 就回退 DEFAULT_CONTEXT_TOKENS;用户也可在设置里用 contextTokens 手动覆盖。
const DEFAULT_CONTEXT_TOKENS = 128_000;
const CONTEXT_WINDOW_TABLE: { prefix: string; tokens: number }[] = [
  // 长前缀在前,确保 gpt-4o-mini 不被 gpt-4 之类短前缀抢先。
  { prefix: "claude", tokens: 200_000 },
  { prefix: "gemini-1.5", tokens: 1_000_000 },
  { prefix: "gemini-2", tokens: 1_000_000 },
  { prefix: "gemini", tokens: 1_000_000 },
  { prefix: "gpt-4o", tokens: 128_000 },
  { prefix: "gpt-4.1", tokens: 1_000_000 },
  { prefix: "gpt-4-turbo", tokens: 128_000 },
  { prefix: "gpt-4", tokens: 8_192 },
  { prefix: "gpt-3.5", tokens: 16_385 },
  { prefix: "o1", tokens: 200_000 },
  { prefix: "o3", tokens: 200_000 },
];

// 当前模型的上下文上限(token)。优先用户手填的 contextTokens,否则查表猜测,再回退默认。
export function getContextLimit(config: AppConfig): number {
  if (config.contextTokens) return config.contextTokens;
  const model = config.model.toLowerCase().trim();
  const hit = CONTEXT_WINDOW_TABLE.find((e) => model.startsWith(e.prefix));
  return hit?.tokens ?? DEFAULT_CONTEXT_TOKENS;
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
    baseUrl: "http://192.168.31.154:8045/v1",
    model: "gpt-4o-mini",
  },
  gemini: {
    label: "Gemini (原生 API)",
    baseUrl: "http://192.168.31.154:8045/v1beta",
    model: "gemini-2.0-flash",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    baseUrl: "http://192.168.31.154:8045/v1",
    model: "claude-sonnet-4-20250514",
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
  autoBilingual: false,
};

// 缓存当前配置(useSyncExternalStore 要求 getSnapshot 返回稳定引用),
// 仅在 saveConfig 时替换并通知订阅者。
let cached: AppConfig | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    // 脏数据(版本迁移 / 手改)校验失败时回落默认,不把非法值带进运行时。
    const parsed = AppConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      ...(JSON.parse(raw) as object),
    });
    return parsed.success ? parsed.data : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function loadConfig(): AppConfig {
  if (!cached) cached = readFromStorage();
  return cached;
}

export function saveConfig(config: AppConfig): void {
  cached = config;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  for (const l of listeners) l();
}

function subscribeConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 响应式读取配置:设置页 saveConfig 后,所有用 useConfig 的组件即时更新
// (不再需要重挂载或切会话)。
export function useConfig(): AppConfig {
  return useSyncExternalStore(subscribeConfig, loadConfig);
}

// 从配置 + keychain 组装 provider。无 key 时返回 null,调用方据此提示去设置页填 key。
export async function getProvider(): Promise<ModelProvider | null> {
  const config = loadConfig();
  const apiKey = await getSecret(apiKeyAccount(config.providerType));
  if (!apiKey) return null;
  const base = { baseUrl: config.baseUrl, apiKey, model: config.model };
  let provider: ModelProvider;
  if (config.providerType === "gemini") {
    provider = createGeminiProvider(base);
  } else if (config.providerType === "anthropic") {
    provider = createAnthropicProvider(base);
  } else {
    provider = createOpenAIProvider(base);
  }
  return withPlugins(provider, defaultPlugins());
}
