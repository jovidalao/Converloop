import { CheckCircle2Icon, GraduationCapIcon } from "lucide-react";
import { useState } from "react";
import { type Locale, UI_LOCALES, useTranslation } from "@/i18n";
import {
  apiKeyAccount,
  getProviderFor,
  isOAuthProvider,
  loadConfig,
  oauthAccount,
  PROVIDER_PRESETS,
  PROVIDER_TYPES,
  type ProviderType,
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
    setVerified(false);
    setStatus(null);
    setError(null);
    const next = { ...loadConfig(), providerType: type };
    setCfg(next);
    saveConfig(next);
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
      const reply = await provider.generate({
        messages: [
          { role: "user", content: "Reply with the single word: pong" },
        ],
      });
      setVerified(true);
      setStatus(t("onboarding.testOk", { sample: reply.trim().slice(0, 40) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const preset = PROVIDER_PRESETS[providerType];
  const oauth = isOAuthProvider(providerType);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background">
      <div className="flex w-full max-w-lg flex-col gap-6 px-8">
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
                <SelectTrigger variant="ghost">
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
                <SelectTrigger variant="ghost">
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
                <SelectTrigger variant="ghost">
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
                <SelectTrigger variant="ghost">
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
            <Row label={t("onboarding.provider")}>
              <Select
                value={providerType}
                onValueChange={(v) => pickProvider(v as ProviderType)}
              >
                <SelectTrigger variant="ghost">
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
            </Row>
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
      <div className="min-w-0">{children}</div>
    </div>
  );
}
