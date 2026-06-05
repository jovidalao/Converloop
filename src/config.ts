import { useSyncExternalStore } from "react";
import { z } from "zod";
import { getSecret } from "./keychain";
import { refreshAnthropic } from "./oauth/anthropic";
import { refreshOpenAICodex } from "./oauth/openai";
import { getTokens, type OAuthTokens, setTokens } from "./oauth/store";
import { createAnthropicProvider } from "./providers/anthropic";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenAIProvider } from "./providers/openai";
import { createOpenAICodexProvider } from "./providers/openai-responses";
import { defaultPlugins, withPlugins } from "./providers/plugins";
import type { ModelProvider } from "./providers/types";

// claude-oauth / codex-oauth:用订阅(Claude Pro/Max、ChatGPT)浏览器登录,而非 API key。
export type ProviderType =
  | "openai"
  | "gemini"
  | "anthropic"
  | "claude-oauth"
  | "codex-oauth";

// 非密配置存 localStorage;API key 走设备绑定加密文件(见 keychain.ts → Rust secrets.rs)。
const AppConfigSchema = z.object({
  providerType: z.enum([
    "openai",
    "gemini",
    "anthropic",
    "claude-oauth",
    "codex-oauth",
  ]),
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

// 订阅登录 provider 的令牌 account(JSON {access,refresh,expires}),与 API key 分开存。
export function oauthAccount(type: ProviderType): string {
  return `${type}_oauth`;
}

const OAUTH_PROVIDERS = new Set<ProviderType>(["claude-oauth", "codex-oauth"]);

// 是否走订阅 OAuth 登录(而非填 API key)。SettingsView 据此切换登录 UI。
export function isOAuthProvider(type: ProviderType): boolean {
  return OAUTH_PROVIDERS.has(type);
}

export interface ProviderModelOption {
  label: string;
  model: string;
}

interface ProviderPreset {
  label: string;
  shortLabel: string;
  baseUrl: string;
  /** 默认模型:切换 provider 时使用,也作为模型列表的第一项。 */
  model: string;
  models: ProviderModelOption[];
}

// 切换 provider 时给设置页/聊天输入区共用的预设(baseUrl + 可选模型)。
export const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  openai: {
    label: "OpenAI 兼容(OpenAI / OpenRouter / LM Studio)",
    shortLabel: "OpenAI 兼容",
    baseUrl: "http://192.168.31.154:8045/v1",
    model: "gpt-4o-mini",
    models: [
      { label: "GPT-4o mini", model: "gpt-4o-mini" },
      { label: "GPT-4o", model: "gpt-4o" },
      { label: "GPT-4.1", model: "gpt-4.1" },
      { label: "GPT-5 mini", model: "gpt-5-mini" },
      { label: "GPT-5", model: "gpt-5" },
    ],
  },
  gemini: {
    label: "Gemini (原生 API)",
    shortLabel: "Gemini",
    baseUrl: "http://192.168.31.154:8045/v1beta",
    model: "gemini-2.0-flash",
    models: [
      { label: "Gemini 2.0 Flash", model: "gemini-2.0-flash" },
      { label: "Gemini 1.5 Flash", model: "gemini-1.5-flash" },
      { label: "Gemini 1.5 Pro", model: "gemini-1.5-pro" },
    ],
  },
  anthropic: {
    label: "Anthropic (Claude)",
    shortLabel: "Anthropic Claude",
    baseUrl: "http://192.168.31.154:8045/v1",
    model: "claude-sonnet-4-20250514",
    models: [
      { label: "Claude Sonnet 4", model: "claude-sonnet-4-20250514" },
      { label: "Claude Opus 4.1", model: "claude-opus-4-1-20250805" },
      { label: "Claude Haiku 3.5", model: "claude-3-5-haiku-20241022" },
    ],
  },
  // 订阅登录:令牌直连 Anthropic 官方 API(非代理),模型可在设置里改成订阅可用的型号。
  "claude-oauth": {
    label: "Claude (Pro/Max 登录)",
    shortLabel: "Claude Code",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    models: [
      { label: "Claude Sonnet 4.5", model: "claude-sonnet-4-5" },
      { label: "Claude Opus 4.1", model: "claude-opus-4-1-20250805" },
      { label: "Claude Sonnet 4", model: "claude-sonnet-4-20250514" },
      { label: "Claude Haiku 3.5", model: "claude-3-5-haiku-20241022" },
    ],
  },
  // Codex 订阅登录:走 ChatGPT 后端 Responses API,模型用 codex 系列。
  "codex-oauth": {
    label: "ChatGPT (Codex 登录)",
    shortLabel: "ChatGPT Codex",
    baseUrl: "https://chatgpt.com/backend-api",
    model: "gpt-5-codex",
    models: [{ label: "GPT-5 Codex", model: "gpt-5-codex" }],
  },
};

export function findProviderModelOption(
  type: ProviderType,
  model: string,
): ProviderModelOption | undefined {
  const normalized = model.trim();
  return PROVIDER_PRESETS[type].models.find((m) => m.model === normalized);
}

export function providerModelLabel(type: ProviderType, model: string): string {
  const preset = PROVIDER_PRESETS[type];
  const modelLabel =
    findProviderModelOption(type, model)?.label || model.trim() || "自定义模型";
  return `${preset.shortLabel} · ${modelLabel}`;
}

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

// OAuth provider 的令牌刷新单飞:热路径上对话 ∥ 导师几乎同时取 provider,
// 不去重会把同一次刷新打两遍(其中一个换来的 refresh token 随即失效)。
const refreshInFlight = new Map<ProviderType, Promise<OAuthTokens>>();

// 取当前令牌;过期则刷新并回写。无令牌(未登录)返回 null。
async function ensureFreshTokens(
  type: ProviderType,
  refreshFn: (refresh: string) => Promise<OAuthTokens>,
): Promise<OAuthTokens | null> {
  const tokens = await getTokens(oauthAccount(type));
  if (!tokens) return null;
  if (Date.now() < tokens.expires) return tokens;

  let inflight = refreshInFlight.get(type);
  if (!inflight) {
    inflight = refreshFn(tokens.refresh)
      .then(async (fresh) => {
        // 刷新响应若没带回某些字段(如 Codex accountId),沿用旧值。
        const merged: OAuthTokens = { ...tokens, ...fresh };
        await setTokens(oauthAccount(type), merged);
        return merged;
      })
      .finally(() => refreshInFlight.delete(type));
    refreshInFlight.set(type, inflight);
  }
  return inflight;
}

// 从配置 + keychain 组装 provider。无 key / 未登录时返回 null,调用方据此提示去设置页。
export async function getProvider(): Promise<ModelProvider | null> {
  const config = loadConfig();

  if (config.providerType === "claude-oauth") {
    const tokens = await ensureFreshTokens("claude-oauth", refreshAnthropic);
    if (!tokens) return null;
    const provider = createAnthropicProvider({
      baseUrl: config.baseUrl,
      apiKey: tokens.access,
      model: config.model,
      oauth: true,
    });
    return withPlugins(provider, defaultPlugins());
  }

  if (config.providerType === "codex-oauth") {
    const tokens = await ensureFreshTokens("codex-oauth", refreshOpenAICodex);
    if (!tokens) return null;
    const provider = createOpenAICodexProvider({
      baseUrl: config.baseUrl,
      apiKey: tokens.access,
      model: config.model,
      accountId: tokens.accountId,
    });
    return withPlugins(provider, defaultPlugins());
  }

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
