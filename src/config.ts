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
export const PROVIDER_TYPES = [
  "openai",
  "gemini",
  "anthropic",
  "claude-oauth",
  "codex-oauth",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

// 单个 provider 的连接配置:每个 provider 各存一份,切换时互不覆盖。
const ProviderSettingsSchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
  /** 手动覆盖模型上下文窗口(token)。留空则按 model 名查表猜测(见 inferContextLimit)。 */
  contextTokens: z.number().int().positive().optional(),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

// 非密配置存 localStorage;API key 走设备绑定加密文件(见 keychain.ts → Rust secrets.rs)。
const AppConfigSchema = z.object({
  providerType: z.enum(PROVIDER_TYPES),
  /** 每个 provider 的 baseUrl/模型/上下文,按 provider 分别持久化。 */
  providers: z.object({
    openai: ProviderSettingsSchema,
    gemini: ProviderSettingsSchema,
    anthropic: ProviderSettingsSchema,
    "claude-oauth": ProviderSettingsSchema,
    "codex-oauth": ProviderSettingsSchema,
  }),
  nativeLanguage: z.string(),
  targetLanguage: z.string(),
  level: z.string(),
  /** 新 AI 回复自动展开双语对照。 */
  autoBilingual: z.boolean(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// 已知模型的上下文窗口(token),按 model 名前缀匹配。BYOK 下 model 是自由串,命中不了
// 就回退 DEFAULT_CONTEXT_TOKENS;用户也可在设置里用 contextTokens 手动覆盖。
const DEFAULT_CONTEXT_TOKENS = 128_000;
const CONTEXT_WINDOW_TABLE: { prefix: string; tokens: number }[] = [
  // 长前缀在前,确保 gpt-4o-mini 不被 gpt-4 之类短前缀抢先。
  { prefix: "claude-opus-4-8", tokens: 1_000_000 },
  { prefix: "claude-sonnet-4-6", tokens: 1_000_000 },
  { prefix: "claude-haiku-4-5", tokens: 200_000 },
  { prefix: "claude", tokens: 200_000 },
  { prefix: "gemini-1.5", tokens: 1_000_000 },
  { prefix: "gemini-2", tokens: 1_000_000 },
  { prefix: "gemini", tokens: 1_000_000 },
  { prefix: "gpt-5.5", tokens: 1_000_000 },
  { prefix: "gpt-5.4-mini", tokens: 400_000 },
  { prefix: "gpt-5.4-nano", tokens: 400_000 },
  { prefix: "gpt-5.4", tokens: 1_000_000 },
  { prefix: "gpt-5.3-codex-spark", tokens: 400_000 },
  { prefix: "gpt-4o", tokens: 128_000 },
  { prefix: "gpt-4.1", tokens: 1_000_000 },
  { prefix: "gpt-4-turbo", tokens: 128_000 },
  { prefix: "gpt-4", tokens: 8_192 },
  { prefix: "gpt-3.5", tokens: 16_385 },
  { prefix: "o1", tokens: 200_000 },
  { prefix: "o3", tokens: 200_000 },
];

// 按模型名猜测上下文上限(token);命中不了回退默认。
export function inferContextLimit(model: string): number {
  const m = model.toLowerCase().trim();
  const hit = CONTEXT_WINDOW_TABLE.find((e) => m.startsWith(e.prefix));
  return hit?.tokens ?? DEFAULT_CONTEXT_TOKENS;
}

// 当前 provider 的上下文上限(token)。优先用户手填的 contextTokens,否则按模型名猜测。
export function getContextLimit(config: AppConfig): number {
  const active = config.providers[config.providerType];
  return active.contextTokens ?? inferContextLimit(active.model);
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
    model: "claude-sonnet-4-6",
    models: [
      { label: "Claude Opus 4.8", model: "claude-opus-4-8" },
      { label: "Claude Sonnet 4.6", model: "claude-sonnet-4-6" },
      { label: "Claude Haiku 4.5", model: "claude-haiku-4-5-20251001" },
    ],
  },
  // Codex 订阅登录:走 ChatGPT 后端 Responses API,模型用 codex 系列。
  "codex-oauth": {
    label: "ChatGPT (Codex 登录)",
    shortLabel: "ChatGPT Codex",
    baseUrl: "https://chatgpt.com/backend-api",
    model: "gpt-5.5",
    models: [
      { label: "GPT-5.5", model: "gpt-5.5" },
      { label: "GPT-5.4", model: "gpt-5.4" },
      { label: "GPT-5.4 mini", model: "gpt-5.4-mini" },
      { label: "GPT-5.3 Codex Spark", model: "gpt-5.3-codex-spark" },
    ],
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

// 用 provider 预设填某个 provider 的初始连接配置。
function presetSettings(type: ProviderType): ProviderSettings {
  const p = PROVIDER_PRESETS[type];
  return { baseUrl: p.baseUrl, model: p.model };
}

function defaultProviders(): Record<ProviderType, ProviderSettings> {
  return {
    openai: presetSettings("openai"),
    gemini: presetSettings("gemini"),
    anthropic: presetSettings("anthropic"),
    "claude-oauth": presetSettings("claude-oauth"),
    "codex-oauth": presetSettings("codex-oauth"),
  };
}

// 当前激活 provider 的连接配置。
export function activeProvider(config: AppConfig): ProviderSettings {
  return config.providers[config.providerType];
}

// 选模型:切到该 provider 并设其模型(保留该 provider 已存的 baseUrl/上下文覆盖)。
export function withActiveModel(
  config: AppConfig,
  providerType: ProviderType,
  model: string,
): AppConfig {
  return {
    ...config,
    providerType,
    providers: {
      ...config.providers,
      [providerType]: { ...config.providers[providerType], model },
    },
  };
}

const DEFAULT_CONFIG: AppConfig = {
  providerType: "openai",
  providers: defaultProviders(),
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
  autoBilingual: false,
};

function freshDefault(): AppConfig {
  return { ...DEFAULT_CONFIG, providers: defaultProviders() };
}

// 缓存当前配置(useSyncExternalStore 要求 getSnapshot 返回稳定引用),
// 仅在 saveConfig 时替换并通知订阅者。
let cached: AppConfig | null = null;
const listeners = new Set<() => void>();

// 把存储里的 providers 还原成完整映射;旧版扁平配置(顶层 baseUrl/model/contextTokens)
// 迁移到当时激活 provider 那一项。
function migrateProviders(
  obj: Record<string, unknown>,
): Record<ProviderType, ProviderSettings> {
  const providers = defaultProviders();
  const stored = obj.providers;
  if (stored && typeof stored === "object") {
    for (const type of PROVIDER_TYPES) {
      const parsed = ProviderSettingsSchema.safeParse(
        (stored as Record<string, unknown>)[type],
      );
      if (parsed.success) providers[type] = parsed.data;
    }
    return providers;
  }
  if (typeof obj.baseUrl === "string") {
    const type =
      typeof obj.providerType === "string" &&
      (PROVIDER_TYPES as readonly string[]).includes(obj.providerType)
        ? (obj.providerType as ProviderType)
        : DEFAULT_CONFIG.providerType;
    providers[type] = {
      baseUrl: obj.baseUrl,
      model: typeof obj.model === "string" ? obj.model : providers[type].model,
      contextTokens:
        typeof obj.contextTokens === "number" ? obj.contextTokens : undefined,
    };
  }
  return providers;
}

function readFromStorage(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefault();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // 脏数据(版本迁移 / 手改)校验失败时回落默认,不把非法值带进运行时。
    const parsed = AppConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      ...obj,
      providers: migrateProviders(obj),
    });
    return parsed.success ? parsed.data : freshDefault();
  } catch {
    return freshDefault();
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

// 用指定 provider 的配置 + keychain 组装 provider。无 key / 未登录时返回 null。
async function buildProviderFor(
  config: AppConfig,
  type: ProviderType,
): Promise<ModelProvider | null> {
  const entry = config.providers[type];

  if (type === "claude-oauth") {
    const tokens = await ensureFreshTokens("claude-oauth", refreshAnthropic);
    if (!tokens) return null;
    const provider = createAnthropicProvider({
      baseUrl: entry.baseUrl,
      apiKey: tokens.access,
      model: entry.model,
      oauth: true,
    });
    return withPlugins(provider, defaultPlugins());
  }

  if (type === "codex-oauth") {
    const tokens = await ensureFreshTokens("codex-oauth", refreshOpenAICodex);
    if (!tokens) return null;
    const provider = createOpenAICodexProvider({
      baseUrl: entry.baseUrl,
      apiKey: tokens.access,
      model: entry.model,
      accountId: tokens.accountId,
    });
    return withPlugins(provider, defaultPlugins());
  }

  const apiKey = await getSecret(apiKeyAccount(type));
  if (!apiKey) return null;
  const base = { baseUrl: entry.baseUrl, apiKey, model: entry.model };
  let provider: ModelProvider;
  if (type === "gemini") {
    provider = createGeminiProvider(base);
  } else if (type === "anthropic") {
    provider = createAnthropicProvider(base);
  } else {
    provider = createOpenAIProvider(base);
  }
  return withPlugins(provider, defaultPlugins());
}

// 从配置 + keychain 组装当前激活 provider。无 key / 未登录时返回 null,调用方据此提示去设置页。
export async function getProvider(): Promise<ModelProvider | null> {
  const config = loadConfig();
  return buildProviderFor(config, config.providerType);
}

// 设置页用:构建指定 provider(可能不是当前激活的)以测试其连接。
export function getProviderFor(
  type: ProviderType,
): Promise<ModelProvider | null> {
  return buildProviderFor(loadConfig(), type);
}
