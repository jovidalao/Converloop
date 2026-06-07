import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import claudeLogo from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import { ChevronDownIcon, SparklesIcon, Volume2Icon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type Locale, type MessageKey, useTranslation } from "@/i18n";
import { isWindows } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  type AppConfig,
  apiKeyAccount,
  findProviderModelOption,
  getProviderFor,
  inferContextLimit,
  isOAuthProvider,
  loadConfig,
  oauthAccount,
  PROVIDER_PRESETS,
  PROVIDER_TYPES,
  type ProviderSettings,
  type ProviderType,
  providerModelLabel,
  saveConfig,
} from "../config";
import { deleteSecret, getSecret, setSecret } from "../keychain";
import { loginAnthropic } from "../oauth/anthropic";
import { loginOpenAICodex } from "../oauth/openai";
import {
  clearTokens,
  getTokens,
  type OAuthTokens,
  setTokens,
} from "../oauth/store";
import {
  EDGE_VOICES,
  loadTtsConfig,
  MIMO_TTS_KEY_ACCOUNT,
  MIMO_VOICES,
  saveTtsConfig,
  type TtsConfig,
  type TtsProvider,
} from "../tts/config";
import { synthesizeEdge } from "../tts/edge";
import { synthesizeMimo } from "../tts/mimo";
import { clearTtsCache, getTtsCacheCount } from "../tts/speak";
import { ShortcutsEditor } from "./ShortcutsEditor";
import { type Accent, type Theme, useTheme } from "./theme-provider";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

// A form field: label + control. Inside a row, flex-1 makes fields share width.
function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span className="text-ui-meta font-medium text-ui-muted">{label}</span>
      {children}
    </div>
  );
}

function ToggleField({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border/70 bg-card/70 px-3.5 py-2.5 text-ui-body">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

const THEMES: { value: Theme; labelKey: MessageKey }[] = [
  { value: "light", labelKey: "settings.themes.light" },
  { value: "dark", labelKey: "settings.themes.dark" },
  { value: "system", labelKey: "settings.themes.system" },
];
// Accent swatches use the light-mode --brand value, purely as a selection marker.
const ACCENTS: { value: Accent; labelKey: MessageKey; swatch: string }[] = [
  {
    value: "gray",
    labelKey: "settings.accents.gray",
    swatch: "oklch(0.44 0.006 286)",
  },
  {
    value: "blue",
    labelKey: "settings.accents.blue",
    swatch: "oklch(0.5729 0.2337 264.3664)",
  },
  {
    value: "purple",
    labelKey: "settings.accents.purple",
    swatch: "oklch(0.55 0.2 292)",
  },
  {
    value: "claude",
    labelKey: "settings.accents.claude",
    swatch: "oklch(0.6171 0.1375 39.0427)",
  },
];
const LOCALES: { value: Locale; labelKey: MessageKey }[] = [
  { value: "en", labelKey: "settings.languages.en" },
  { value: "zh", labelKey: "settings.languages.zh" },
];
const CUSTOM_MODEL_VALUE = "__custom_model__";
export type SettingsSection = "general" | "llm" | "tts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Each provider's brand icon (local SVG asset); colors follow ChatView's ModelLogo.
const PROVIDER_BRAND: Record<ProviderType, { svg: string; className: string }> =
  {
    openai: { svg: openAiLogo, className: "text-foreground" },
    gemini: { svg: geminiLogo, className: "text-brand" },
    anthropic: { svg: anthropicLogo, className: "text-info" },
    "claude-oauth": { svg: claudeLogo, className: "text-info" },
    "codex-oauth": { svg: openAiLogo, className: "text-foreground" },
  };

function ProviderBrandIcon({ type }: { type: ProviderType }) {
  const brand = PROVIDER_BRAND[type];
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center [&_svg]:size-5",
        brand.className,
      )}
      role="img"
      aria-label={PROVIDER_PRESETS[type].shortLabel}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: vetted local SVG asset string
      dangerouslySetInnerHTML={{ __html: brand.svg }}
    />
  );
}

// A provider card in the list: the header shows "in use / configured" status at
// a glance; expanding it reveals that provider's configuration form.
function ProviderCard({
  icon,
  title,
  statusText,
  configured,
  active,
  expanded,
  onToggle,
  onActivate,
  children,
}: {
  icon: ReactNode;
  title: string;
  statusText: string;
  configured: boolean;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onActivate: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card/80 shadow-minimal-flat transition-colors",
        active ? "border-primary/50 bg-primary/[0.04]" : "border-border/80",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-accent/45"
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-ui-body font-medium">{title}</span>
            {active && (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-ui-micro font-medium text-primary-foreground">
                {t("settings.card.inUse")}
              </span>
            )}
          </span>
          <span className="truncate text-ui-caption text-ui-muted">
            {statusText}
          </span>
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-ui-caption",
            configured ? "text-success-text" : "text-ui-muted",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              configured ? "bg-success" : "bg-foreground/25",
            )}
          />
          {configured
            ? t("settings.card.configured")
            : t("settings.card.notConfigured")}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-ui-muted transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/70 bg-background/45 px-5 py-5">
          {active ? (
            <p className="mb-5 text-ui-caption text-ui-muted">
              {t("settings.card.current")}
            </p>
          ) : (
            <Button size="sm" className="mb-5" onClick={onActivate}>
              {t("settings.card.setCurrent")}
            </Button>
          )}
          <div className="space-y-5">{children}</div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border bg-card/70 p-1">
      {THEMES.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setTheme(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-ui-body transition-colors",
            theme === opt.value
              ? "bg-accent text-foreground"
              : "text-ui-muted hover:text-foreground",
          )}
        >
          {t(opt.labelKey)}
        </button>
      ))}
    </div>
  );
}

function AccentToggle() {
  const { accent, setAccent } = useTheme();
  const { t } = useTranslation();
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border bg-card/70 p-1">
      {ACCENTS.map((a) => (
        <button
          key={a.value}
          type="button"
          onClick={() => setAccent(a.value)}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-ui-body transition-colors",
            accent === a.value
              ? "bg-accent text-foreground"
              : "text-ui-muted hover:text-foreground",
          )}
        >
          <span
            className="size-3 rounded-full"
            style={{ background: a.swatch }}
          />
          {t(a.labelKey)}
        </button>
      ))}
    </div>
  );
}

function LanguageToggle() {
  const { locale, setLocale, t } = useTranslation();
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-lg border bg-card/70 p-1">
      {LOCALES.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setLocale(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-ui-body transition-colors",
            locale === opt.value
              ? "bg-accent text-foreground"
              : "text-ui-muted hover:text-foreground",
          )}
        >
          {t(opt.labelKey)}
        </button>
      ))}
    </div>
  );
}

function GlassToggle() {
  const { glassEnabled, setGlassEnabled } = useTheme();
  const { t } = useTranslation();
  return (
    <ToggleField checked={glassEnabled} onChange={setGlassEnabled}>
      {t("settings.general.glass")}
    </ToggleField>
  );
}

export function SettingsView({ section }: { section: SettingsSection }) {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<AppConfig>(loadConfig);
  const [ttsCfg, setTtsCfg] = useState<TtsConfig>(loadTtsConfig());

  // Load every provider's config status once (whether it has a key / is signed
  // in) so each card can display it directly.
  const [keyStatus, setKeyStatus] = useState<
    Partial<Record<ProviderType, boolean>>
  >({});
  const [oauthTokens, setOauthTokens] = useState<
    Partial<Record<ProviderType, OAuthTokens | null>>
  >({});
  const [hasTtsKey, setHasTtsKey] = useState(false);

  // Single-open accordion: expand the current provider by default.
  const [expandedLlm, setExpandedLlm] = useState<ProviderType | null>(
    () => loadConfig().providerType,
  );
  const [expandedTts, setExpandedTts] = useState<TtsProvider | null>(
    () => loadTtsConfig().ttsProvider,
  );

  const [keyInputs, setKeyInputs] = useState<
    Partial<Record<ProviderType, string>>
  >({});
  // The user explicitly chose "custom model" for a provider (even if the current
  // model still matches a preset).
  const [customModel, setCustomModel] = useState<
    Partial<Record<ProviderType, boolean>>
  >({});
  const [ttsKeyInput, setTtsKeyInput] = useState("");

  const [loggingIn, setLoggingIn] = useState<ProviderType | null>(null);
  const [testingLlm, setTestingLlm] = useState<ProviderType | null>(null);
  const [llmStatus, setLlmStatus] = useState<{
    type: ProviderType;
    text: string;
  } | null>(null);

  const [testingTts, setTestingTts] = useState<TtsProvider | null>(null);
  const [ttsStatus, setTtsStatus] = useState<{
    provider: TtsProvider;
    text: string;
  } | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  const [ttsCacheCount, setTtsCacheCount] = useState<number | null>(null);
  const [clearingTtsCache, setClearingTtsCache] = useState(false);

  const keyPlaceholders: Record<ProviderType, string> = {
    openai: "sk-…",
    gemini: "AIza…",
    anthropic: "sk-ant-…",
    "claude-oauth": "",
    "codex-oauth": "",
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const keys = await Promise.all(
        PROVIDER_TYPES.filter((t) => !isOAuthProvider(t)).map(
          async (t) => [t, !!(await getSecret(apiKeyAccount(t)))] as const,
        ),
      );
      const oauth = await Promise.all(
        PROVIDER_TYPES.filter(isOAuthProvider).map(
          async (t) => [t, await getTokens(oauthAccount(t))] as const,
        ),
      );
      if (!alive) return;
      setKeyStatus(Object.fromEntries(keys));
      setOauthTokens(Object.fromEntries(oauth));
    })();
    void getSecret(MIMO_TTS_KEY_ACCOUNT).then(
      (k) => alive && setHasTtsKey(!!k),
    );
    void getTtsCacheCount().then((n) => alive && setTtsCacheCount(n));
    return () => {
      alive = false;
    };
  }, []);

  function update<K extends keyof AppConfig>(k: K, v: AppConfig[K]) {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    saveConfig(next);
  }

  // Change one provider's connection config (without affecting the others, and
  // not necessarily the currently active one).
  function updateProvider(
    type: ProviderType,
    patch: Partial<ProviderSettings>,
  ) {
    const next: AppConfig = {
      ...cfg,
      providers: {
        ...cfg.providers,
        [type]: { ...cfg.providers[type], ...patch },
      },
    };
    setCfg(next);
    saveConfig(next);
  }

  function selectModel(type: ProviderType, value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      setCustomModel((prev) => ({ ...prev, [type]: true }));
      return;
    }
    setCustomModel((prev) => ({ ...prev, [type]: false }));
    updateProvider(type, { model: value });
  }

  function resetToPreset(type: ProviderType) {
    const p = PROVIDER_PRESETS[type];
    setCustomModel((prev) => ({ ...prev, [type]: false }));
    updateProvider(type, {
      baseUrl: p.baseUrl,
      model: p.model,
      contextTokens: undefined,
    });
  }

  async function saveKey(type: ProviderType) {
    const v = (keyInputs[type] ?? "").trim();
    if (!v) return;
    await setSecret(apiKeyAccount(type), v);
    setKeyInputs((prev) => ({ ...prev, [type]: "" }));
    setKeyStatus((prev) => ({ ...prev, [type]: true }));
    setLlmStatus({ type, text: t("settings.llm.keySaved") });
  }

  async function clearKey(type: ProviderType) {
    await deleteSecret(apiKeyAccount(type));
    setKeyStatus((prev) => ({ ...prev, [type]: false }));
    setLlmStatus({ type, text: t("settings.llm.keyCleared") });
  }

  function loginForProvider(type: ProviderType): Promise<OAuthTokens> {
    if (type === "claude-oauth") return loginAnthropic();
    if (type === "codex-oauth") return loginOpenAICodex();
    throw new Error(t("settings.llm.noSubscription"));
  }

  async function handleOauthLogin(type: ProviderType) {
    setLoggingIn(type);
    setLlmStatus(null);
    try {
      const tokens = await loginForProvider(type);
      await setTokens(oauthAccount(type), tokens);
      setOauthTokens((prev) => ({ ...prev, [type]: tokens }));
      setLlmStatus({ type, text: t("settings.llm.loginSuccess") });
    } catch (e) {
      setLlmStatus({
        type,
        text: t("settings.llm.loginFailed", { error: errText(e) }),
      });
    } finally {
      setLoggingIn(null);
    }
  }

  async function handleOauthLogout(type: ProviderType) {
    await clearTokens(oauthAccount(type));
    setOauthTokens((prev) => ({ ...prev, [type]: null }));
    setLlmStatus({ type, text: t("settings.llm.loggedOut") });
  }

  // Run both generate (non-streaming) and stream (streaming) with the same key,
  // for this card's provider.
  async function testConnection(type: ProviderType) {
    setTestingLlm(type);
    setLlmStatus(null);
    try {
      const provider = await getProviderFor(type);
      if (!provider) {
        setLlmStatus({ type, text: t("settings.llm.testNoCredential") });
        return;
      }
      const gen = await provider.generate({
        messages: [
          { role: "user", content: "Reply with the single word: pong" },
        ],
      });
      let streamed = "";
      await provider.stream(
        { messages: [{ role: "user", content: "Count from 1 to 5." }] },
        (d) => {
          streamed += d;
        },
      );
      setLlmStatus({
        type,
        text: t("settings.llm.testOk", {
          sample: gen.trim().slice(0, 40),
          count: streamed.length,
        }),
      });
    } catch (e) {
      setLlmStatus({
        type,
        text: t("settings.llm.testFailed", { error: errText(e) }),
      });
    } finally {
      setTestingLlm(null);
    }
  }

  function updateTts<K extends keyof TtsConfig>(k: K, v: TtsConfig[K]) {
    const next = { ...ttsCfg, [k]: v };
    setTtsCfg(next);
    saveTtsConfig(next);
  }

  async function saveTtsKey() {
    if (!ttsKeyInput.trim()) return;
    await setSecret(MIMO_TTS_KEY_ACCOUNT, ttsKeyInput.trim());
    setTtsKeyInput("");
    setHasTtsKey(true);
    setTtsStatus({
      provider: "mimo",
      text: t("settings.tts.mimoKeySaved"),
    });
  }

  async function clearTtsKey() {
    await deleteSecret(MIMO_TTS_KEY_ACCOUNT);
    setHasTtsKey(false);
    setTtsStatus({ provider: "mimo", text: t("settings.tts.mimoKeyCleared") });
  }

  async function testTts(provider: TtsProvider) {
    setTestingTts(provider);
    setTtsStatus(null);
    try {
      let audio: ArrayBuffer;
      if (provider === "edge") {
        audio = await synthesizeEdge({
          text: "Hello, this is a test.",
          voice: ttsCfg.edgeVoice,
          rate: ttsCfg.edgeRate,
          pitch: ttsCfg.edgePitch,
        });
      } else {
        const apiKey = await getSecret(MIMO_TTS_KEY_ACCOUNT);
        if (!apiKey) {
          setTtsStatus({ provider, text: t("settings.tts.noMimoKey") });
          return;
        }
        audio = await synthesizeMimo({
          apiKey,
          baseUrl: ttsCfg.baseUrl,
          model: ttsCfg.model,
          voice: ttsCfg.voice,
          stylePrompt: ttsCfg.stylePrompt,
          text: "Hello, this is a test.",
        });
      }
      setTtsStatus({
        provider,
        text: t("settings.tts.ttsOk", { bytes: audio.byteLength }),
      });
    } catch (e) {
      setTtsStatus({
        provider,
        text: t("settings.tts.testFailed", { error: errText(e) }),
      });
    } finally {
      setTestingTts(null);
    }
  }

  async function handleClearTtsCache() {
    setClearingTtsCache(true);
    setCacheStatus(null);
    try {
      const removed = await clearTtsCache();
      setTtsCacheCount(0);
      setCacheStatus(t("settings.tts.cacheCleared", { n: removed }));
    } catch (e) {
      setCacheStatus(t("settings.tts.cacheClearFailed", { error: errText(e) }));
    } finally {
      setClearingTtsCache(false);
    }
  }

  function renderLlmCard(type: ProviderType) {
    const entry = cfg.providers[type];
    const preset = PROVIDER_PRESETS[type];
    const oauth = isOAuthProvider(type);
    const tokens = oauthTokens[type] ?? null;
    const hasKey = !!keyStatus[type];
    const configured = oauth ? !!tokens : hasKey;
    const selectedModel = findProviderModelOption(type, entry.model);
    const isCustom = (customModel[type] ?? false) || !selectedModel;
    const modelValue =
      isCustom || !selectedModel ? CUSTOM_MODEL_VALUE : selectedModel.model;
    const statusText = oauth
      ? tokens
        ? t("settings.llm.statusSignedIn")
        : t("settings.llm.statusSignedOut")
      : hasKey
        ? t("settings.llm.statusKeySaved")
        : t("settings.llm.statusKeyUnset");

    return (
      <ProviderCard
        key={type}
        icon={<ProviderBrandIcon type={type} />}
        title={preset.label}
        statusText={statusText}
        configured={configured}
        active={cfg.providerType === type}
        expanded={expandedLlm === type}
        onToggle={() => setExpandedLlm((prev) => (prev === type ? null : type))}
        onActivate={() => update("providerType", type)}
      >
        <Field label={t(`settings.baseUrl.${type}`)}>
          <Input
            value={entry.baseUrl}
            onChange={(e) => updateProvider(type, { baseUrl: e.target.value })}
            placeholder={preset.baseUrl}
          />
        </Field>

        <Field label={t("settings.llm.model")}>
          <Select
            value={modelValue}
            onValueChange={(v) => selectModel(type, v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {preset.models.map((model) => (
                <SelectItem key={model.model} value={model.model}>
                  {providerModelLabel(type, model.model)}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_MODEL_VALUE}>
                {t("settings.llm.customModelOption", {
                  label: preset.shortLabel,
                })}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {isCustom ? (
          <Field label={t("settings.llm.customModelId")}>
            <Input
              value={entry.model}
              onChange={(e) => {
                setCustomModel((prev) => ({ ...prev, [type]: true }));
                updateProvider(type, { model: e.target.value });
              }}
              placeholder={preset.model}
            />
          </Field>
        ) : (
          selectedModel && (
            <p className="-mt-3 break-all text-ui-caption text-ui-muted">
              {t("settings.llm.modelId", { id: selectedModel.model })}
            </p>
          )
        )}

        <Field label={t("settings.llm.contextWindow")}>
          <Input
            type="number"
            value={entry.contextTokens ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              updateProvider(type, {
                contextTokens: e.target.value.trim() && n > 0 ? n : undefined,
              });
            }}
            placeholder={t("settings.llm.contextAuto", {
              n: inferContextLimit(entry.model).toLocaleString(),
            })}
          />
        </Field>

        {oauth ? (
          <div className="flex flex-col gap-2.5">
            <span className="text-ui-meta font-medium text-ui-muted">
              {t("settings.llm.subscriptionLogin", {
                state: tokens
                  ? t("settings.llm.stateSignedIn")
                  : t("settings.llm.stateSignedOut"),
              })}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleOauthLogin(type)}
                disabled={loggingIn === type}
              >
                {loggingIn === type
                  ? t("settings.llm.waitingBrowser")
                  : tokens
                    ? t("settings.llm.reLogin")
                    : t("settings.llm.loginWithBrowser")}
              </Button>
              {tokens && (
                <Button
                  variant="secondary"
                  onClick={() => void handleOauthLogout(type)}
                >
                  {t("settings.llm.logout")}
                </Button>
              )}
            </div>
            {tokens && (
              <span className="text-ui-caption text-ui-muted">
                {t("settings.llm.tokenRefresh", {
                  date: new Date(tokens.expires).toLocaleString(),
                })}
              </span>
            )}
            <span className="text-ui-caption leading-snug text-ui-muted">
              {t("settings.llm.subscriptionWarning")}
            </span>
          </div>
        ) : (
          <Field
            label={t("settings.llm.apiKeyLabel", {
              state: hasKey
                ? t("settings.llm.apiKeyStateSaved")
                : t("settings.llm.apiKeyStateUnset"),
            })}
          >
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="password"
                className="flex-1"
                value={keyInputs[type] ?? ""}
                onChange={(e) =>
                  setKeyInputs((prev) => ({ ...prev, [type]: e.target.value }))
                }
                placeholder={hasKey ? "••••••••" : keyPlaceholders[type]}
              />
              <Button
                onClick={() => void saveKey(type)}
                disabled={!(keyInputs[type] ?? "").trim()}
              >
                {t("settings.llm.saveKey")}
              </Button>
              {hasKey && (
                <Button variant="secondary" onClick={() => void clearKey(type)}>
                  {t("settings.llm.clear")}
                </Button>
              )}
            </div>
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void testConnection(type)}
            disabled={testingLlm === type}
          >
            {testingLlm === type
              ? t("settings.llm.testing")
              : t("settings.llm.testConnection")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => resetToPreset(type)}>
            {t("settings.llm.restorePreset")}
          </Button>
        </div>

        {llmStatus?.type === type && (
          <p className="mt-2 break-words text-ui-body text-primary">
            {llmStatus.text}
          </p>
        )}
      </ProviderCard>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 pt-10 pb-12">
      <div className="mx-auto w-full max-w-4xl">
        {section === "general" && (
          <section className="space-y-7">
            <div className="space-y-2 border-b border-border/70 pb-5">
              <h2 className="mt-0 text-ui-title font-semibold tracking-tight">
                {t("settings.general.title")}
              </h2>
              <p className="max-w-2xl text-ui-body leading-relaxed text-ui-muted">
                {t("settings.general.description")}
              </p>
            </div>

            <div className="grid gap-5 rounded-xl border border-border/70 bg-card/75 p-5 shadow-minimal-flat md:grid-cols-2">
              <Field label={t("settings.general.interfaceLanguage")}>
                <LanguageToggle />
              </Field>

              <Field label={t("settings.general.theme")}>
                <ThemeToggle />
              </Field>

              <Field label={t("settings.general.accent")}>
                <AccentToggle />
              </Field>

              {!isWindows() && (
                <div className="md:col-span-2">
                  <GlassToggle />
                </div>
              )}
            </div>

            <div className="grid gap-4 rounded-xl border border-border/70 bg-card/75 p-5 shadow-minimal-flat sm:grid-cols-3">
              <Field label={t("settings.general.nativeLanguage")}>
                <Input
                  value={cfg.nativeLanguage}
                  onChange={(e) => update("nativeLanguage", e.target.value)}
                />
              </Field>
              <Field label={t("settings.general.targetLanguage")}>
                <Input
                  value={cfg.targetLanguage}
                  onChange={(e) => update("targetLanguage", e.target.value)}
                />
              </Field>
              <Field label={t("settings.general.level")}>
                <Input
                  value={cfg.level}
                  onChange={(e) => update("level", e.target.value)}
                />
              </Field>
            </div>

            <ToggleField
              checked={cfg.autoBilingual}
              onChange={(v) => update("autoBilingual", v)}
            >
              {t("settings.general.autoBilingual")}
            </ToggleField>

            <ShortcutsEditor />
          </section>
        )}

        {section === "llm" && (
          <section className="space-y-6">
            <div className="space-y-2 border-b border-border/70 pb-5">
              <h2 className="mt-0 text-ui-title font-semibold tracking-tight">
                {t("settings.llm.title")}
              </h2>
              <p className="max-w-2xl text-ui-body leading-relaxed text-ui-muted">
                {t("settings.llm.description")}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {PROVIDER_TYPES.map(renderLlmCard)}
            </div>
          </section>
        )}

        {section === "tts" && (
          <section className="space-y-6">
            <div className="space-y-2 border-b border-border/70 pb-5">
              <h2 className="mt-0 text-ui-title font-semibold tracking-tight">
                {t("settings.tts.title")}
              </h2>
              <p className="max-w-2xl text-ui-body leading-relaxed text-ui-muted">
                {t("settings.tts.description")}
                {ttsCacheCount !== null &&
                  t("settings.tts.cacheCount", { n: ttsCacheCount })}
              </p>
            </div>

            <ToggleField
              checked={ttsCfg.autoSpeak}
              onChange={(v) => updateTts("autoSpeak", v)}
            >
              {t("settings.tts.autoSpeak")}
            </ToggleField>

            <div className="flex flex-col gap-4">
              <ProviderCard
                icon={<SparklesIcon className="size-5 shrink-0 text-brand" />}
                title={t("settings.tts.mimoTitle")}
                statusText={
                  hasTtsKey
                    ? t("settings.llm.statusKeySaved")
                    : t("settings.llm.statusKeyUnset")
                }
                configured={hasTtsKey}
                active={ttsCfg.ttsProvider === "mimo"}
                expanded={expandedTts === "mimo"}
                onToggle={() =>
                  setExpandedTts((prev) => (prev === "mimo" ? null : "mimo"))
                }
                onActivate={() => updateTts("ttsProvider", "mimo")}
              >
                <Field
                  label={t("settings.tts.mimoApiKeyLabel", {
                    state: hasTtsKey
                      ? t("settings.llm.apiKeyStateSaved")
                      : t("settings.llm.apiKeyStateUnset"),
                  })}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      type="password"
                      className="flex-1"
                      value={ttsKeyInput}
                      onChange={(e) => setTtsKeyInput(e.target.value)}
                      placeholder={
                        hasTtsKey
                          ? "••••••••"
                          : t("settings.tts.mimoKeyPlaceholder")
                      }
                    />
                    <Button
                      onClick={() => void saveTtsKey()}
                      disabled={!ttsKeyInput.trim()}
                    >
                      {t("settings.tts.saveKey")}
                    </Button>
                    {hasTtsKey && (
                      <Button
                        variant="secondary"
                        onClick={() => void clearTtsKey()}
                      >
                        {t("settings.tts.clear")}
                      </Button>
                    )}
                  </div>
                </Field>

                <Field label={t("settings.tts.stylePrompt")}>
                  <Textarea
                    className="min-h-18 resize-y leading-snug"
                    value={ttsCfg.stylePrompt}
                    onChange={(e) => updateTts("stylePrompt", e.target.value)}
                    rows={3}
                    placeholder={t("settings.tts.stylePromptPlaceholder")}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("settings.tts.voice")}>
                    <Select
                      value={ttsCfg.voice}
                      onValueChange={(v) => updateTts("voice", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MIMO_VOICES.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("settings.tts.model")}>
                    <Input
                      value={ttsCfg.model}
                      onChange={(e) => updateTts("model", e.target.value)}
                    />
                  </Field>
                </div>

                <Field label={t("settings.tts.baseUrl")}>
                  <Input
                    value={ttsCfg.baseUrl}
                    onChange={(e) => updateTts("baseUrl", e.target.value)}
                  />
                </Field>

                <Button
                  variant="secondary"
                  onClick={() => void testTts("mimo")}
                  disabled={testingTts === "mimo"}
                >
                  {testingTts === "mimo"
                    ? t("settings.tts.testing")
                    : t("settings.tts.testTts")}
                </Button>
                {ttsStatus?.provider === "mimo" && (
                  <p className="mt-2 break-words text-ui-body text-primary">
                    {ttsStatus.text}
                  </p>
                )}
              </ProviderCard>

              <ProviderCard
                icon={<Volume2Icon className="size-5 shrink-0 text-info" />}
                title={t("settings.tts.edgeTitle")}
                statusText={t("settings.tts.edgeStatus")}
                configured
                active={ttsCfg.ttsProvider === "edge"}
                expanded={expandedTts === "edge"}
                onToggle={() =>
                  setExpandedTts((prev) => (prev === "edge" ? null : "edge"))
                }
                onActivate={() => updateTts("ttsProvider", "edge")}
              >
                <p className="text-ui-body leading-relaxed text-ui-muted">
                  {t("settings.tts.edgeDescription")}
                </p>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <Field label={t("settings.tts.voice")}>
                    <Select
                      value={ttsCfg.edgeVoice}
                      onValueChange={(v) => updateTts("edgeVoice", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EDGE_VOICES.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("settings.tts.rate")}>
                    <Input
                      value={ttsCfg.edgeRate}
                      onChange={(e) => updateTts("edgeRate", e.target.value)}
                      placeholder="+0%"
                    />
                  </Field>
                  <Field label={t("settings.tts.pitch")}>
                    <Input
                      value={ttsCfg.edgePitch}
                      onChange={(e) => updateTts("edgePitch", e.target.value)}
                      placeholder="+0Hz"
                    />
                  </Field>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => void testTts("edge")}
                  disabled={testingTts === "edge"}
                >
                  {testingTts === "edge"
                    ? t("settings.tts.testing")
                    : t("settings.tts.testTts")}
                </Button>
                {ttsStatus?.provider === "edge" && (
                  <p className="mt-2 break-words text-ui-body text-primary">
                    {ttsStatus.text}
                  </p>
                )}
              </ProviderCard>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleClearTtsCache()}
                disabled={clearingTtsCache || ttsCacheCount === 0}
              >
                {clearingTtsCache
                  ? t("settings.tts.clearing")
                  : t("settings.tts.clearCache")}
              </Button>
              {cacheStatus && (
                <span className="break-words text-ui-body text-primary">
                  {cacheStatus}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
