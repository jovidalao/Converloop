import {
  CheckCircle2Icon,
  GraduationCapIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState } from "react";
import { type Locale, UI_LOCALES, useTranslation } from "@/i18n";
import {
  type AppConfig,
  apiKeyAccount,
  effectiveJsonObjectFallback,
  findModelOption,
  getProviderFor,
  inferContextLimit,
  isOAuthProvider,
  isOpenAIWireProvider,
  loadConfig,
  oauthAccount,
  PROVIDER_PRESETS,
  PROVIDER_TYPES,
  type ProviderSettings,
  type ProviderType,
  providerAllowsContextOverride,
  providerModelLabel,
  providerModels,
  saveConfig,
} from "../config";
import { setSecret } from "../keychain";
import { loginAnthropic } from "../oauth/anthropic";
import { loginOpenAICodex } from "../oauth/openai";
import { setTokens } from "../oauth/store";
import {
  biLabel,
  LEVELS,
  NATIVE_LANGUAGES,
  TARGET_LANGUAGES,
} from "./SettingsView";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";

const CUSTOM_MODEL_VALUE = "__custom_model__";
const LLM_TEST_TIMEOUT_MS = 20_000;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// First-run wizard: two steps to a working app — (1) who is learning what,
// (2) connect one model provider and verify it. Full-screen overlay shown only
// when there is no existing data (see App); skippable, never shown again once
// finished or skipped (app_state flag). Everything here writes through the same
// config/keychain paths as the settings page — no parallel state.
export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t, locale, setLocale } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [cfg, setCfg] = useState(() => loadConfig());
  const [providerType, setProviderType] = useState<ProviderType>(
    () => loadConfig().providerType,
  );
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState<"test" | "login" | null>(null);
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState(false);

  function update<K extends "nativeLanguage" | "targetLanguage" | "level">(
    key: K,
    value: string,
  ) {
    const next = { ...cfg, [key]: value };
    setCfg(next);
    saveConfig(next);
  }

  function pickProvider(type: ProviderType) {
    setProviderType(type);
    const nextConfig = loadConfig();
    setCustomModel(
      !isOAuthProvider(type) &&
        !findModelOption(
          type,
          nextConfig.providers[type],
          nextConfig.providers[type].model,
        ),
    );
    setVerified(false);
    setStatus(null);
    setError(null);
    const next = { ...nextConfig, providerType: type };
    setCfg(next);
    saveConfig(next);
  }

  function updateProvider(patch: Partial<ProviderSettings>) {
    setVerified(false);
    setStatus(null);
    setError(null);
    const next: AppConfig = {
      ...cfg,
      providers: {
        ...cfg.providers,
        [providerType]: { ...cfg.providers[providerType], ...patch },
      },
    };
    setCfg(next);
    saveConfig(next);
  }

  function selectModel(value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      setCustomModel(true);
      setVerified(false);
      return;
    }
    setCustomModel(false);
    updateProvider({ model: value });
  }

  function resetProvider() {
    const preset = PROVIDER_PRESETS[providerType];
    setCustomModel(false);
    updateProvider({
      baseUrl: preset.baseUrl,
      model: preset.model,
      contextTokens: undefined,
      jsonObjectFallback: undefined,
      customModels: undefined,
    });
  }

  // Save the typed key (if any), then run a real round-trip through the provider.
  async function saveAndTest() {
    if (busy) return;
    setBusy("test");
    setStatus(null);
    setError(null);
    try {
      if (keyInput.trim()) {
        await setSecret(apiKeyAccount(providerType), keyInput.trim());
        setKeyInput("");
      }
      const provider = await getProviderFor(providerType);
      if (!provider) {
        setError(t("onboarding.noCredential"));
        return;
      }
      const reply = await withTimeout(
        provider.generate({
          messages: [
            { role: "user", content: "Reply with the single word: pong" },
          ],
          temperature: 0,
          maxTokens: 64,
        }),
        LLM_TEST_TIMEOUT_MS,
        "Generate test",
      );
      const entry = loadConfig().providers[providerType];
      const model = entry.model.trim();
      if (
        model &&
        !isOAuthProvider(providerType) &&
        !findModelOption(providerType, entry, model)
      ) {
        updateProvider({
          customModels: [...(entry.customModels ?? []), model],
        });
        setCustomModel(false);
      }
      setVerified(true);
      setStatus(t("onboarding.testOk", { sample: reply.trim().slice(0, 40) }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function oauthLogin() {
    if (busy) return;
    setBusy("login");
    setStatus(null);
    setError(null);
    try {
      const tokens =
        providerType === "claude-oauth"
          ? await loginAnthropic()
          : await loginOpenAICodex();
      await setTokens(oauthAccount(providerType), tokens);
      setVerified(true);
      setStatus(t("onboarding.loginOk"));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const preset = PROVIDER_PRESETS[providerType];
  const oauth = isOAuthProvider(providerType);
  const entry = cfg.providers[providerType];
  const modelOptions = oauth
    ? preset.models
    : providerModels(providerType, entry);
  const selectedModel = modelOptions.find((m) => m.model === entry.model);
  const modelValue =
    !oauth && (customModel || !selectedModel)
      ? CUSTOM_MODEL_VALUE
      : (selectedModel?.model ?? preset.model);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-background py-10"
      data-app-portal-root
    >
      <div className="flex w-full max-w-2xl flex-col gap-6 px-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GraduationCapIcon className="size-5" />
          </span>
          <h1 className="m-0 text-ui-title font-semibold tracking-tight">
            {t("onboarding.title")}
          </h1>
          <p className="m-0 max-w-sm text-ui-body leading-relaxed text-ui-muted">
            {step === 1
              ? t("onboarding.subtitleLanguages")
              : t("onboarding.subtitleProvider")}
          </p>
        </div>

        {step === 1 ? (
          <div>
            <Row label={t("settings.general.interfaceLanguage")}>
              <Select
                value={locale}
                onValueChange={(v) => setLocale(v as Locale)}
              >
                <SelectTrigger variant="ghost" className="min-w-48 justify-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UI_LOCALES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label={t("settings.general.nativeLanguage")}>
              <Select
                value={cfg.nativeLanguage}
                onValueChange={(v) => update("nativeLanguage", v)}
              >
                <SelectTrigger variant="ghost" className="min-w-48 justify-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NATIVE_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {biLabel(l.label, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label={t("settings.general.targetLanguage")}>
              <Select
                value={cfg.targetLanguage}
                onValueChange={(v) => update("targetLanguage", v)}
              >
                <SelectTrigger variant="ghost" className="min-w-48 justify-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {biLabel(l.label, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label={t("settings.general.level")}>
              <Select
                value={cfg.level}
                onValueChange={(v) => update("level", v)}
              >
                <SelectTrigger variant="ghost" className="min-w-48 justify-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {biLabel(l.label, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <FormField label={t("onboarding.provider")}>
              <Select
                value={providerType}
                onValueChange={(v) => pickProvider(v as ProviderType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {PROVIDER_PRESETS[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {!oauth && (
              <FormField label={t(`settings.baseUrl.${providerType}`)}>
                <Input
                  value={entry.baseUrl}
                  onChange={(e) => updateProvider({ baseUrl: e.target.value })}
                  placeholder={preset.baseUrl}
                />
              </FormField>
            )}

            <FormField label={t("settings.llm.model")}>
              <Select value={modelValue} onValueChange={selectModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.model} value={model.model}>
                      {providerModelLabel(providerType, model.model)}
                    </SelectItem>
                  ))}
                  {!oauth && (
                    <SelectItem value={CUSTOM_MODEL_VALUE}>
                      {t("settings.llm.customModelOption", {
                        label: preset.shortLabel,
                      })}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </FormField>

            {!oauth && (customModel || !selectedModel) ? (
              <FormField label={t("settings.llm.customModelId")}>
                <Input
                  value={entry.model}
                  onChange={(e) => {
                    setCustomModel(true);
                    updateProvider({ model: e.target.value });
                  }}
                  placeholder={preset.model}
                />
              </FormField>
            ) : (
              selectedModel && (
                <p className="-mt-2 m-0 break-all text-ui-caption text-ui-muted">
                  {t("settings.llm.modelId", { id: selectedModel.model })}
                </p>
              )
            )}

            {providerAllowsContextOverride(providerType) && (
              <FormField label={t("settings.llm.contextWindow")}>
                <Input
                  type="number"
                  value={entry.contextTokens ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    updateProvider({
                      contextTokens:
                        e.target.value.trim() && n > 0 ? n : undefined,
                    });
                  }}
                  placeholder={t("settings.llm.contextAuto", {
                    n: inferContextLimit(entry.model).toLocaleString(),
                  })}
                />
              </FormField>
            )}

            {isOpenAIWireProvider(providerType) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-4 border-b border-border/70 py-3">
                  <span className="text-ui-body">
                    {t("settings.llm.jsonObjectFallback")}
                  </span>
                  <Switch
                    checked={effectiveJsonObjectFallback(providerType, entry)}
                    onCheckedChange={(v) =>
                      updateProvider({ jsonObjectFallback: v })
                    }
                    className="shrink-0"
                  />
                </div>
                <p className="m-0 text-ui-caption leading-snug text-ui-muted">
                  {t("settings.llm.jsonObjectFallbackHint")}
                </p>
              </div>
            )}

            {oauth ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-ui-caption leading-snug text-ui-muted">
                  {t("settings.llm.subscriptionWarning")}
                </p>
                <Button
                  onClick={() => void oauthLogin()}
                  disabled={busy !== null}
                >
                  {busy === "login" ? (
                    <Spinner />
                  ) : (
                    t("settings.llm.loginWithBrowser")
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  type="password"
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setVerified(false);
                  }}
                  placeholder={t("onboarding.keyPlaceholder", {
                    provider: preset.shortLabel,
                  })}
                />
                <p className="m-0 text-ui-caption leading-snug text-ui-muted">
                  {t("settings.llm.keyStorageNote")}
                </p>
                <Button
                  onClick={() => void saveAndTest()}
                  disabled={busy !== null || (!keyInput.trim() && !verified)}
                >
                  {busy === "test" ? <Spinner /> : t("onboarding.saveAndTest")}
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-fit self-end"
              onClick={resetProvider}
            >
              <RotateCcwIcon className="size-4" />
              {t("settings.llm.restorePreset")}
            </Button>
            {status && (
              <p className="m-0 flex items-center gap-1.5 text-ui-body text-success">
                <CheckCircle2Icon className="size-4 shrink-0" />
                <span className="min-w-0 break-words">{status}</span>
              </p>
            )}
            {error && (
              <p className="m-0 break-words text-ui-body text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-ui-caption text-ui-muted transition-colors hover:text-foreground"
            onClick={onDone}
          >
            {t("onboarding.skip")}
          </button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <Button variant="ghost" onClick={() => setStep(1)}>
                {t("common.back")}
              </Button>
            )}
            {step === 1 ? (
              <Button onClick={() => setStep(2)}>{t("onboarding.next")}</Button>
            ) : (
              <Button onClick={onDone} disabled={!verified}>
                {t("onboarding.finish")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Same divider-row look as the settings page (label left, control right).
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-0">
      <span className="shrink-0 text-ui-body">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-ui-meta font-medium text-ui-muted">{label}</span>
      {children}
    </div>
  );
}
