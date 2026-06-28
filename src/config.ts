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

// deepseek…minimax: extra OpenAI-compatible API-key providers (reuse the OpenAI adapter, only the baseUrl/model differ).
// claude-oauth / codex-oauth: sign in via subscription (Claude Pro/Max, ChatGPT) browser login instead of an API key.
export const PROVIDER_TYPES = [
  "openai",
  "gemini",
  "anthropic",
  "deepseek",
  "openrouter",
  "xai",
  "mistral",
  "qwen",
  "moonshot",
  "glm",
  "minimax",
  "claude-oauth",
  "codex-oauth",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

// Per-provider connection settings: one copy stored per provider; switching providers does not overwrite others.
const ProviderSettingsSchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
  /** Manual override for the model context window (tokens). Leave unset to infer from the model name (see inferContextLimit). */
  contextTokens: z.number().int().positive().optional(),
  /** Override the endpoint's json-schema capability: true forces the json_object fallback, false forces json_schema,
   *  unset = the provider preset's default (see effectiveJsonObjectFallback). Only used by OpenAI-wire providers. */
  jsonObjectFallback: z.boolean().optional(),
  /** Custom model ids the user typed and verified via "test connection"; shown alongside the preset models. */
  customModels: z.array(z.string()).optional(),
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export interface ProviderSelection {
  providerType: ProviderType;
  model: string;
}

// Non-secret config is stored in localStorage; API keys go into a device-bound encrypted file (see keychain.ts → Rust secrets.rs).
const AppConfigSchema = z.object({
  providerType: z.enum(PROVIDER_TYPES),
  /** Per-provider baseUrl/model/context settings, persisted separately per provider. */
  providers: z.object({
    openai: ProviderSettingsSchema,
    gemini: ProviderSettingsSchema,
    anthropic: ProviderSettingsSchema,
    deepseek: ProviderSettingsSchema,
    openrouter: ProviderSettingsSchema,
    xai: ProviderSettingsSchema,
    mistral: ProviderSettingsSchema,
    qwen: ProviderSettingsSchema,
    moonshot: ProviderSettingsSchema,
    glm: ProviderSettingsSchema,
    minimax: ProviderSettingsSchema,
    "claude-oauth": ProviderSettingsSchema,
    "codex-oauth": ProviderSettingsSchema,
  }),
  nativeLanguage: z.string(),
  targetLanguage: z.string(),
  level: z.string(),
  /** Automatically expand bilingual reading for new AI replies. */
  autoBilingual: z.boolean(),
  /** Show text labels next to chat action buttons (bilingual / custom transformers). Off = icon only. */
  actionLabels: z.boolean(),
  /** Auto-generate reply coaching hints after each turn (one extra model call per turn).
   *  Off = hints are only generated on demand via the coach panel's regenerate button. */
  inputHintsAuto: z.boolean(),
  /** Daily practice goal: target countable sentences/day, shown as the progress ring on the new-chat start page. */
  dailyGoal: z.number().int().positive(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// Context window (tokens) for known models, matched by model name prefix. In BYOK mode the model is a free-form string; if no prefix matches,
// fall back to DEFAULT_CONTEXT_TOKENS. Users can also override manually with contextTokens in settings.
const DEFAULT_CONTEXT_TOKENS = 128_000;
const CONTEXT_WINDOW_TABLE: { prefix: string; tokens: number }[] = [
  // Longer prefixes first, so gpt-4o-mini is not captured by a shorter prefix like gpt-4.
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
  // Extra OpenAI-compatible providers (windows per models.dev, 2026-06). OpenRouter keeps its vendor/ prefix and falls through to the default.
  { prefix: "deepseek", tokens: 1_000_000 },
  { prefix: "grok-build", tokens: 256_000 },
  { prefix: "grok-4.3", tokens: 1_000_000 },
  { prefix: "grok-4.20", tokens: 2_000_000 },
  { prefix: "grok-4-fast", tokens: 2_000_000 },
  { prefix: "grok", tokens: 256_000 },
  { prefix: "codestral", tokens: 256_000 },
  { prefix: "mistral", tokens: 262_144 },
  { prefix: "devstral", tokens: 262_144 },
  { prefix: "qwen", tokens: 1_000_000 },
  { prefix: "kimi", tokens: 262_144 },
  { prefix: "moonshot", tokens: 131_072 },
  { prefix: "glm-4.6", tokens: 200_000 },
  { prefix: "glm", tokens: 204_800 },
  { prefix: "minimax-m3", tokens: 512_000 },
  { prefix: "minimax", tokens: 204_800 },
];

// Infer the context limit (tokens) from the model name; falls back to the default if no prefix matches.
export function inferContextLimit(model: string): number {
  const m = model.toLowerCase().trim();
  const hit = CONTEXT_WINDOW_TABLE.find((e) => m.startsWith(e.prefix));
  return hit?.tokens ?? DEFAULT_CONTEXT_TOKENS;
}

function providerContextLimit(
  type: ProviderType,
  settings: ProviderSettings,
  model = settings.model,
): number {
  if (!providerAllowsContextOverride(type)) return inferContextLimit(model);
  return settings.contextTokens ?? inferContextLimit(model);
}

// Context limit (tokens) for the active provider. API-key providers can use the user-supplied contextTokens override; subscription-login providers are inferred from the model.
export function getContextLimit(config: AppConfig): number {
  const active = config.providers[config.providerType];
  return providerContextLimit(config.providerType, active);
}

export function getContextLimitForSelection(
  config: AppConfig,
  selection?: ProviderSelection | null,
): number {
  if (!selection) return getContextLimit(config);
  const active = config.providers[selection.providerType];
  return providerContextLimit(selection.providerType, active, selection.model);
}

// Each provider's key is stored separately so switching providers does not lose the other.
export function apiKeyAccount(type: ProviderType): string {
  return `${type}_api_key`;
}

// Token account for subscription-login providers (JSON {access,refresh,expires}), stored separately from the API key.
export function oauthAccount(type: ProviderType): string {
  return `${type}_oauth`;
}

const OAUTH_PROVIDERS = new Set<ProviderType>(["claude-oauth", "codex-oauth"]);

// Whether the provider uses subscription OAuth login (rather than an API key). SettingsView uses this to toggle the login UI.
export function isOAuthProvider(type: ProviderType): boolean {
  return OAUTH_PROVIDERS.has(type);
}

export function providerAllowsContextOverride(type: ProviderType): boolean {
  return !isOAuthProvider(type);
}

// Providers that speak the OpenAI chat/completions wire format (routed through createOpenAIProvider). Excludes the
// native adapters (gemini/anthropic) and the OAuth providers; gates the json_object-fallback switch in settings.
const OPENAI_WIRE_PROVIDERS = new Set<ProviderType>([
  "openai",
  "deepseek",
  "openrouter",
  "xai",
  "mistral",
  "qwen",
  "moonshot",
  "glm",
  "minimax",
]);

export function isOpenAIWireProvider(type: ProviderType): boolean {
  return OPENAI_WIRE_PROVIDERS.has(type);
}

// Effective "downgrade json_schema → json_object" setting: an explicit per-provider override wins, otherwise the
// provider preset's default (true for vendors known to lack json_schema support), otherwise off.
export function effectiveJsonObjectFallback(
  type: ProviderType,
  settings: ProviderSettings,
): boolean {
  return (
    settings.jsonObjectFallback ??
    PROVIDER_PRESETS[type].jsonObjectFallback ??
    false
  );
}

export interface ProviderModelOption {
  label: string;
  model: string;
}

interface ProviderPreset {
  label: string;
  shortLabel: string;
  baseUrl: string;
  /** Default model: used when switching to this provider and also the first item in the model list. */
  model: string;
  models: ProviderModelOption[];
  /** Default for OpenAI-wire providers whose endpoint can't honor response_format:json_schema (overridable per provider). */
  jsonObjectFallback?: boolean;
}

// Presets shared between the settings page and chat input when switching providers (baseUrl + optional model list).
export const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  openai: {
    label: "OpenAI Compatible (OpenAI / OpenRouter / LM Studio)",
    shortLabel: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
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
    label: "Gemini (Native API)",
    shortLabel: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
    models: [
      { label: "Gemini 3.5 Flash", model: "gemini-3.5-flash" },
      { label: "Gemini 3.1 Pro Preview", model: "gemini-3.1-pro-preview" },
      { label: "Gemini 3 Flash Preview", model: "gemini-3-flash-preview" },
      { label: "Gemini 3.1 Flash-Lite", model: "gemini-3.1-flash-lite" },
      { label: "Gemini 2.5 Pro", model: "gemini-2.5-pro" },
      { label: "Gemini 2.5 Flash", model: "gemini-2.5-flash" },
    ],
  },
  anthropic: {
    label: "Anthropic (Claude)",
    shortLabel: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    models: [
      { label: "Claude Sonnet 4", model: "claude-sonnet-4-20250514" },
      { label: "Claude Opus 4.1", model: "claude-opus-4-1-20250805" },
      { label: "Claude Haiku 3.5", model: "claude-3-5-haiku-20241022" },
    ],
  },
  // The following all speak the OpenAI chat/completions wire format, so buildProviderFor routes them through createOpenAIProvider; only baseUrl + model differ.
  // Model lists track models.dev (2026-06); -latest/stable aliases preferred so they auto-upgrade. Any id can be overridden in settings.
  deepseek: {
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    jsonObjectFallback: true,
    models: [
      { label: "DeepSeek V3.2 (chat)", model: "deepseek-chat" },
      { label: "DeepSeek V3.2 (reasoner)", model: "deepseek-reasoner" },
      { label: "DeepSeek V4 Flash", model: "deepseek-v4-flash" },
      { label: "DeepSeek V4 Pro", model: "deepseek-v4-pro" },
    ],
  },
  openrouter: {
    label: "OpenRouter (200+ models)",
    shortLabel: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.6",
    // OpenRouter model ids are vendor/model; type any slug from openrouter.ai/models.
    models: [
      { label: "Claude Sonnet 4.6", model: "anthropic/claude-sonnet-4.6" },
      { label: "Claude Opus 4.8", model: "anthropic/claude-opus-4.8" },
      { label: "GPT-5.5", model: "openai/gpt-5.5" },
      { label: "Gemini 3.5 Flash", model: "google/gemini-3.5-flash" },
      { label: "DeepSeek V3.2", model: "deepseek/deepseek-v3.2" },
    ],
  },
  xai: {
    label: "xAI (Grok)",
    shortLabel: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.3",
    models: [
      { label: "Grok 4.3", model: "grok-4.3" },
      { label: "Grok Build 0.1 (coding)", model: "grok-build-0.1" },
      { label: "Grok 4 Fast", model: "grok-4-fast" },
    ],
  },
  mistral: {
    label: "Mistral AI",
    shortLabel: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-medium-latest",
    models: [
      { label: "Mistral Medium", model: "mistral-medium-latest" },
      { label: "Mistral Large", model: "mistral-large-latest" },
      { label: "Mistral Small", model: "mistral-small-latest" },
      { label: "Codestral", model: "codestral-latest" },
      { label: "Devstral Medium", model: "devstral-medium-latest" },
    ],
  },
  qwen: {
    label: "Qwen (Alibaba DashScope)",
    shortLabel: "Qwen",
    // DashScope OpenAI-compatible mode; switch to dashscope-intl.aliyuncs.com for the international account.
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    jsonObjectFallback: true,
    models: [
      { label: "Qwen Plus", model: "qwen-plus" },
      { label: "Qwen Max", model: "qwen-max" },
      { label: "Qwen Turbo", model: "qwen-turbo" },
      { label: "Qwen3 Coder Plus", model: "qwen3-coder-plus" },
    ],
  },
  moonshot: {
    label: "Moonshot (Kimi)",
    shortLabel: "Kimi",
    // China endpoint; switch to api.moonshot.ai/v1 for the international account.
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-latest",
    jsonObjectFallback: true,
    models: [
      { label: "Kimi (latest)", model: "kimi-latest" },
      { label: "Kimi K2.5", model: "kimi-k2.5" },
      { label: "Kimi K2 Turbo", model: "kimi-k2-turbo-preview" },
      { label: "Moonshot v1 128K", model: "moonshot-v1-128k" },
    ],
  },
  glm: {
    label: "Zhipu GLM",
    shortLabel: "GLM",
    // bigmodel.cn endpoint; switch to api.z.ai/api/paas/v4 for the international (z.ai) account.
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.1",
    jsonObjectFallback: true,
    models: [
      { label: "GLM-5.1", model: "glm-5.1" },
      { label: "GLM-5", model: "glm-5" },
      { label: "GLM-4.7", model: "glm-4.7" },
      { label: "GLM-4.6", model: "glm-4.6" },
    ],
  },
  minimax: {
    label: "MiniMax",
    shortLabel: "MiniMax",
    // International OpenAI-compatible endpoint; switch to api.minimaxi.com/v1 for the China account.
    baseUrl: "https://api.minimax.io/v1",
    model: "MiniMax-M3",
    jsonObjectFallback: true,
    models: [
      { label: "MiniMax-M3", model: "MiniMax-M3" },
      { label: "MiniMax-M2.7", model: "MiniMax-M2.7" },
      { label: "MiniMax-M2", model: "MiniMax-M2" },
    ],
  },
  // Subscription login: token connects directly to the official Anthropic API (no proxy); model can be changed in settings to any model available under the subscription.
  "claude-oauth": {
    label: "Claude (Pro/Max Login)",
    shortLabel: "Claude Code",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    models: [
      { label: "Claude Opus 4.8", model: "claude-opus-4-8" },
      { label: "Claude Sonnet 4.6", model: "claude-sonnet-4-6" },
      { label: "Claude Haiku 4.5", model: "claude-haiku-4-5-20251001" },
    ],
  },
  // Codex subscription login: uses the ChatGPT backend Responses API; model is from the codex family.
  "codex-oauth": {
    label: "ChatGPT (Codex Login)",
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
    findProviderModelOption(type, model)?.label ||
    model.trim() ||
    "Custom Model";
  return `${preset.shortLabel} · ${modelLabel}`;
}

// Selectable model list for a provider: the preset models plus any user-added custom models
// (typed then verified via "test connection"), appended after the presets and de-duplicated.
export function providerModels(
  type: ProviderType,
  settings: ProviderSettings,
): ProviderModelOption[] {
  const presetModels = PROVIDER_PRESETS[type].models;
  const seen = new Set(presetModels.map((m) => m.model));
  const custom: ProviderModelOption[] = [];
  for (const raw of settings.customModels ?? []) {
    const model = raw.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    custom.push({ label: model, model });
  }
  return [...presetModels, ...custom];
}

// Look up a model option among the preset list AND the provider's saved custom models.
export function findModelOption(
  type: ProviderType,
  settings: ProviderSettings,
  model: string,
): ProviderModelOption | undefined {
  const normalized = model.trim();
  return providerModels(type, settings).find((m) => m.model === normalized);
}

const STORAGE_KEY = "lang-agent.config";

// Fill a provider's initial connection settings from its preset.
function presetSettings(type: ProviderType): ProviderSettings {
  const p = PROVIDER_PRESETS[type];
  return { baseUrl: p.baseUrl, model: p.model };
}

function defaultProviders(): Record<ProviderType, ProviderSettings> {
  return {
    openai: presetSettings("openai"),
    gemini: presetSettings("gemini"),
    anthropic: presetSettings("anthropic"),
    deepseek: presetSettings("deepseek"),
    openrouter: presetSettings("openrouter"),
    xai: presetSettings("xai"),
    mistral: presetSettings("mistral"),
    qwen: presetSettings("qwen"),
    moonshot: presetSettings("moonshot"),
    glm: presetSettings("glm"),
    minimax: presetSettings("minimax"),
    "claude-oauth": presetSettings("claude-oauth"),
    "codex-oauth": presetSettings("codex-oauth"),
  };
}

// Connection settings for the currently active provider.
export function activeProvider(config: AppConfig): ProviderSettings {
  return config.providers[config.providerType];
}

// Select a model: switch to the given provider and set its model (preserving the provider's existing baseUrl/context override).
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
  nativeLanguage: "Simplified Chinese",
  targetLanguage: "English",
  level: "B1",
  autoBilingual: false,
  actionLabels: false,
  inputHintsAuto: true,
  dailyGoal: 10,
};

function freshDefault(): AppConfig {
  return { ...DEFAULT_CONFIG, providers: defaultProviders() };
}

// Cache of the current config (useSyncExternalStore requires getSnapshot to return a stable reference);
// replaced and subscribers notified only on saveConfig.
let cached: AppConfig | null = null;
const listeners = new Set<() => void>();

// Restore providers from storage into a complete map; old flat configs (top-level baseUrl/model/contextTokens)
// are migrated into the entry for the then-active provider.
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

function migrateNativeLanguage(value: unknown): unknown {
  if (typeof value !== "string") return DEFAULT_CONFIG.nativeLanguage;
  return value === "Chinese" ? "Simplified Chinese" : value;
}

function readFromStorage(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefault();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // When dirty data (version migration / hand-edit) fails validation, fall back to defaults rather than letting invalid values enter the runtime.
    const parsed = AppConfigSchema.safeParse({
      ...DEFAULT_CONFIG,
      ...obj,
      nativeLanguage: migrateNativeLanguage(obj.nativeLanguage),
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

// Reactive config read: after saveConfig in the settings page, all components using useConfig update immediately
// (no need to remount or switch sessions).
export function useConfig(): AppConfig {
  return useSyncExternalStore(subscribeConfig, loadConfig);
}

// Single-flight token refresh for OAuth providers: on the hot path, the conversation and tutor both fetch the provider almost simultaneously,
// and without deduplication the same refresh would be fired twice (one of the resulting refresh tokens would immediately become invalid).
const refreshInFlight = new Map<ProviderType, Promise<OAuthTokens>>();

// Fetch the current tokens; refresh and write back if expired. Returns null when there are no tokens (not logged in).
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
        // If the refresh response omits some fields (e.g. Codex accountId), retain the old values.
        const merged: OAuthTokens = { ...tokens, ...fresh };
        await setTokens(oauthAccount(type), merged);
        return merged;
      })
      .finally(() => refreshInFlight.delete(type));
    refreshInFlight.set(type, inflight);
  }
  return inflight;
}

// Build a provider from the given provider type's config + keychain. Returns null when there is no key or the user is not logged in.
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
    provider = createOpenAIProvider({
      ...base,
      jsonObjectFallback: effectiveJsonObjectFallback(type, entry),
    });
  }
  return withPlugins(provider, defaultPlugins());
}

// Build the currently active provider from config + keychain. Returns null when there is no key or the user is not logged in; callers use this to prompt the user to visit settings.
export async function getProvider(
  selection?: ProviderSelection | null,
): Promise<ModelProvider | null> {
  const config = loadConfig();
  if (!selection) return buildProviderFor(config, config.providerType);
  return buildProviderFor(
    withActiveModel(config, selection.providerType, selection.model),
    selection.providerType,
  );
}

// Used by the settings page: build the specified provider (which may not be the active one) to test its connection.
export function getProviderFor(
  type: ProviderType,
): Promise<ModelProvider | null> {
  return buildProviderFor(loadConfig(), type);
}
