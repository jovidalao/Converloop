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

// claude-oauth / codex-oauth: sign in via subscription (Claude Pro/Max, ChatGPT) browser login instead of an API key.
export const PROVIDER_TYPES = [
  "openai",
  "gemini",
  "anthropic",
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
});

export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

// Non-secret config is stored in localStorage; API keys go into a device-bound encrypted file (see keychain.ts → Rust secrets.rs).
const AppConfigSchema = z.object({
  providerType: z.enum(PROVIDER_TYPES),
  /** Per-provider baseUrl/model/context settings, persisted separately per provider. */
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
  /** Automatically expand bilingual reading for new AI replies. */
  autoBilingual: z.boolean(),
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
];

// Infer the context limit (tokens) from the model name; falls back to the default if no prefix matches.
export function inferContextLimit(model: string): number {
  const m = model.toLowerCase().trim();
  const hit = CONTEXT_WINDOW_TABLE.find((e) => m.startsWith(e.prefix));
  return hit?.tokens ?? DEFAULT_CONTEXT_TOKENS;
}

// Context limit (tokens) for the active provider. Uses the user-supplied contextTokens override if present, otherwise infers from the model name.
export function getContextLimit(config: AppConfig): number {
  const active = config.providers[config.providerType];
  return active.contextTokens ?? inferContextLimit(active.model);
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
}

// Presets shared between the settings page and chat input when switching providers (baseUrl + optional model list).
export const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  openai: {
    label: "OpenAI Compatible (OpenAI / OpenRouter / LM Studio)",
    shortLabel: "OpenAI Compatible",
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
    label: "Gemini (Native API)",
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
  nativeLanguage: "Chinese",
  targetLanguage: "English",
  level: "B1",
  autoBilingual: false,
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

function readFromStorage(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefault();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // When dirty data (version migration / hand-edit) fails validation, fall back to defaults rather than letting invalid values enter the runtime.
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
    provider = createOpenAIProvider(base);
  }
  return withPlugins(provider, defaultPlugins());
}

// Build the currently active provider from config + keychain. Returns null when there is no key or the user is not logged in; callers use this to prompt the user to visit settings.
export async function getProvider(): Promise<ModelProvider | null> {
  const config = loadConfig();
  return buildProviderFor(config, config.providerType);
}

// Used by the settings page: build the specified provider (which may not be the active one) to test its connection.
export function getProviderFor(
  type: ProviderType,
): Promise<ModelProvider | null> {
  return buildProviderFor(loadConfig(), type);
}
