import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import chatglmLogo from "@lobehub/icons-static-svg/icons/chatglm-color.svg?raw";
import claudeLogo from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import deepSeekLogo from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import grokLogo from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import kimiLogo from "@lobehub/icons-static-svg/icons/kimi-color.svg?raw";
import minimaxLogo from "@lobehub/icons-static-svg/icons/minimax-color.svg?raw";
import mistralLogo from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import openRouterLogo from "@lobehub/icons-static-svg/icons/openrouter.svg?raw";
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import type { LucideIcon } from "lucide-react";
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  RotateCcwIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BUILTIN_PROMPT_MACROS,
  isValidMacroName,
  PROMPT_INPUT_TOKEN,
  type PromptMacroDef,
  takenMacroNames,
} from "@/commands";
import { type Locale, type MessageKey, useTranslation } from "@/i18n";
import {
  exportBackupToDownloads,
  importBackupBundle,
  parseBackupBundle,
} from "@/lib/backup";
import { isWindows } from "@/lib/platform";
import { snapshotSettingsToMirror } from "@/lib/settings-mirror";
import { cn } from "@/lib/utils";
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
  providerModelLabel,
  providerModels,
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
import { applyProfilePreferenceInstruction } from "../orchestrator";
import {
  type PreferenceScope,
  preferencesFromProfile,
  updateProfilePreference,
} from "../profile/preferences";
import { readProfile, writeProfile } from "../profile/profile";
import {
  type CustomPromptMacro,
  clearPromptMacroOverride,
  deleteCustomPromptMacro,
  getCustomPromptMacros,
  getPromptMacroOverrides,
  type PromptMacroOverride,
  setPromptMacroOverride,
  upsertCustomPromptMacro,
} from "../runtime/prompt-macro-store";
import {
  type CloudSttProvider,
  loadSttConfig,
  type SttConfig,
  type SttProvider,
  saveSttConfig,
  sttKeyAccount,
} from "../stt/config";
import {
  downloadLocalAsrModel,
  type LocalDownloadProgress,
  type LocalSttEngine,
  localAsrModelStatus,
} from "../stt/local";
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
import { useConfirm } from "./confirm";
import { PreferencesPanel } from "./PreferencesPanel";
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
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-0">
      <span className="text-ui-body">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        className="shrink-0"
      />
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-0">
      <span className="shrink-0 text-ui-body">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Voice input (speech-to-text): Soniox async STT first, plus an
// OpenAI-compatible /audio/transcriptions fallback. Each provider has its own
// key account so switching does not lose credentials.
function SttSettings() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<SttConfig>(() => loadSttConfig());
  const [expandedStt, setExpandedStt] = useState<SttProvider | null>(
    () => loadSttConfig().sttProvider,
  );
  const [keyInputs, setKeyInputs] = useState<
    Partial<Record<CloudSttProvider, string>>
  >({});
  const [keyStatus, setKeyStatus] = useState<
    Partial<Record<CloudSttProvider, boolean>>
  >({});
  const [status, setStatus] = useState<{
    provider: SttProvider;
    text: string;
  } | null>(null);
  // 本地模型(parakeet / qwen3):下载状态(缺省=查询中)与下载进度(缺省=未在下载)。
  const [localReady, setLocalReady] = useState<
    Partial<Record<LocalSttEngine, boolean>>
  >({});
  const [localProgress, setLocalProgress] = useState<
    Partial<Record<LocalSttEngine, LocalDownloadProgress>>
  >({});

  useEffect(() => {
    let alive = true;
    void Promise.all(
      (["soniox", "openai"] satisfies CloudSttProvider[]).map(
        async (provider) =>
          [provider, !!(await getSecret(sttKeyAccount(provider)))] as const,
      ),
    ).then((items) => {
      if (alive) setKeyStatus(Object.fromEntries(items));
    });
    for (const engine of ["parakeet", "qwen3"] satisfies LocalSttEngine[]) {
      void localAsrModelStatus(engine).then((ready) => {
        if (alive) setLocalReady((prev) => ({ ...prev, [engine]: ready }));
      });
    }
    return () => {
      alive = false;
    };
  }, []);

  async function downloadLocal(engine: LocalSttEngine, fileCount: number) {
    setLocalProgress((prev) => ({
      ...prev,
      [engine]: { file: "", fileIndex: 0, fileCount, received: 0, total: 0 },
    }));
    try {
      await downloadLocalAsrModel(engine, (p) =>
        setLocalProgress((prev) => ({ ...prev, [engine]: p })),
      );
      setLocalReady((prev) => ({ ...prev, [engine]: true }));
    } catch (e) {
      setStatus({
        provider: engine,
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLocalProgress((prev) => {
        const next = { ...prev };
        delete next[engine];
        return next;
      });
    }
  }

  function update<K extends keyof SttConfig>(key: K, value: SttConfig[K]) {
    const next = { ...cfg, [key]: value };
    setCfg(next);
    saveSttConfig(next);
  }

  async function saveKey(provider: CloudSttProvider) {
    const value = (keyInputs[provider] ?? "").trim();
    if (!value) return;
    await setSecret(sttKeyAccount(provider), value);
    setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
    setKeyStatus((prev) => ({ ...prev, [provider]: true }));
    setStatus({ provider, text: t("settings.stt.keySaved") });
  }

  async function clearKey(provider: CloudSttProvider) {
    await deleteSecret(sttKeyAccount(provider));
    setKeyStatus((prev) => ({ ...prev, [provider]: false }));
    setStatus({ provider, text: t("settings.stt.keyCleared") });
  }

  const sonioxHasKey = !!keyStatus.soniox;
  const openAiHasKey = !!keyStatus.openai;

  return (
    <section className="space-y-6">
      <div className="space-y-2 border-b border-border/70 pb-5">
        <h2 className="mt-0 text-ui-title font-semibold tracking-tight">
          {t("settings.stt.title")}
        </h2>
        <p className="max-w-2xl text-ui-body leading-relaxed text-ui-muted">
          {t("settings.stt.description")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {!cfg.sttProvider && (
            <p className="m-0 text-ui-caption leading-snug text-ui-muted">
              {t("settings.stt.noProviderSelected")}
            </p>
          )}
          {cfg.sttProvider && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => update("sttProvider", null)}
            >
              {t("settings.stt.disableVoiceInput")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col">
        <ProviderCard
          title={t("settings.stt.sonioxTitle")}
          statusText={
            sonioxHasKey
              ? t("settings.llm.statusKeySaved")
              : t("settings.llm.statusKeyUnset")
          }
          configured={sonioxHasKey}
          active={cfg.sttProvider === "soniox"}
          expanded={expandedStt === "soniox"}
          onToggle={() =>
            setExpandedStt((prev) => (prev === "soniox" ? null : "soniox"))
          }
          onActivate={() => update("sttProvider", "soniox")}
        >
          <p className="text-ui-body leading-relaxed text-ui-muted">
            {t("settings.stt.sonioxDescription")}
          </p>
          <Field
            label={t("settings.stt.sonioxApiKeyLabel", {
              state: sonioxHasKey
                ? t("settings.llm.apiKeyStateSaved")
                : t("settings.llm.apiKeyStateUnset"),
            })}
          >
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="password"
                className="flex-1"
                value={keyInputs.soniox ?? ""}
                onChange={(e) =>
                  setKeyInputs((prev) => ({
                    ...prev,
                    soniox: e.target.value,
                  }))
                }
                placeholder={sonioxHasKey ? "••••••••" : "soniox-…"}
              />
              <Button
                onClick={() => void saveKey("soniox")}
                disabled={!(keyInputs.soniox ?? "").trim()}
              >
                {t("settings.llm.saveKey")}
              </Button>
              {sonioxHasKey && (
                <Button
                  variant="secondary"
                  onClick={() => void clearKey("soniox")}
                >
                  {t("settings.llm.clear")}
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-ui-caption leading-snug text-ui-muted">
              {t("settings.llm.keyStorageNote")}
            </p>
          </Field>

          <Field label={t("settings.stt.sonioxModel")}>
            <Input
              value={cfg.sonioxModel}
              onChange={(e) => update("sonioxModel", e.target.value)}
              placeholder="stt-rt-v3"
            />
            <p className="mt-1.5 text-ui-caption leading-snug text-ui-muted">
              {t("settings.stt.sonioxModelHint")}
            </p>
          </Field>

          {status?.provider === "soniox" && (
            <p className="m-0 break-words text-ui-body text-primary">
              {status.text}
            </p>
          )}
        </ProviderCard>

        <ProviderCard
          title={t("settings.stt.openaiTitle")}
          statusText={
            openAiHasKey
              ? t("settings.llm.statusKeySaved")
              : t("settings.llm.statusKeyUnset")
          }
          configured={openAiHasKey}
          active={cfg.sttProvider === "openai"}
          expanded={expandedStt === "openai"}
          onToggle={() =>
            setExpandedStt((prev) => (prev === "openai" ? null : "openai"))
          }
          onActivate={() => update("sttProvider", "openai")}
        >
          <p className="text-ui-body leading-relaxed text-ui-muted">
            {t("settings.stt.openaiDescription")}
          </p>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label={t("settings.stt.baseUrl")}>
              <Input
                value={cfg.baseUrl}
                onChange={(e) => update("baseUrl", e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </Field>
            <Field label={t("settings.stt.model")}>
              <Input
                value={cfg.model}
                onChange={(e) => update("model", e.target.value)}
                placeholder="whisper-1"
              />
            </Field>
          </div>
          <Field
            label={t("settings.stt.openaiApiKeyLabel", {
              state: openAiHasKey
                ? t("settings.llm.apiKeyStateSaved")
                : t("settings.llm.apiKeyStateUnset"),
            })}
          >
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="password"
                className="flex-1"
                value={keyInputs.openai ?? ""}
                onChange={(e) =>
                  setKeyInputs((prev) => ({
                    ...prev,
                    openai: e.target.value,
                  }))
                }
                placeholder={openAiHasKey ? "••••••••" : "sk-…"}
              />
              <Button
                onClick={() => void saveKey("openai")}
                disabled={!(keyInputs.openai ?? "").trim()}
              >
                {t("settings.llm.saveKey")}
              </Button>
              {openAiHasKey && (
                <Button
                  variant="secondary"
                  onClick={() => void clearKey("openai")}
                >
                  {t("settings.llm.clear")}
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-ui-caption leading-snug text-ui-muted">
              {t("settings.llm.keyStorageNote")}
            </p>
          </Field>

          {status?.provider === "openai" && (
            <p className="m-0 break-words text-ui-body text-primary">
              {status.text}
            </p>
          )}
        </ProviderCard>

        <ProviderCard
          title={t("settings.stt.parakeetTitle")}
          statusText={
            localProgress.parakeet
              ? t("settings.stt.parakeetDownloading", {
                  index: localProgress.parakeet.fileIndex,
                  count: localProgress.parakeet.fileCount,
                })
              : localReady.parakeet
                ? t("settings.stt.parakeetDownloaded")
                : t("settings.stt.parakeetNotDownloaded")
          }
          configured={!!localReady.parakeet}
          active={cfg.sttProvider === "parakeet"}
          expanded={expandedStt === "parakeet"}
          onToggle={() =>
            setExpandedStt((prev) => (prev === "parakeet" ? null : "parakeet"))
          }
          // 未下载不允许切到本地引擎(否则录音转写必然失败)。
          onActivate={() => {
            if (localReady.parakeet) update("sttProvider", "parakeet");
          }}
        >
          <p className="text-ui-body leading-relaxed text-ui-muted">
            {t("settings.stt.parakeetDescription")}
          </p>
          <p className="text-ui-caption leading-snug text-amber-600 dark:text-amber-500">
            {t("settings.stt.parakeetLangNote")}
          </p>
          <Field label={t("settings.stt.parakeetModelLabel")}>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void downloadLocal("parakeet", 4)}
                disabled={!!localProgress.parakeet}
              >
                <DownloadIcon className="size-4" />
                {localProgress.parakeet
                  ? t("settings.stt.parakeetDownloading", {
                      index: localProgress.parakeet.fileIndex,
                      count: localProgress.parakeet.fileCount,
                    })
                  : localReady.parakeet
                    ? t("settings.stt.parakeetRedownload")
                    : t("settings.stt.parakeetDownload")}
              </Button>
              {localReady.parakeet && !localProgress.parakeet && (
                <span className="flex items-center gap-1.5 text-ui-caption text-success">
                  <CheckIcon className="size-3.5" />
                  {t("settings.stt.parakeetDownloaded")}
                </span>
              )}
            </div>
            {localProgress.parakeet && localProgress.parakeet.total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full bg-success transition-[width]"
                  style={{
                    width: `${Math.round(
                      (localProgress.parakeet.received /
                        localProgress.parakeet.total) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            )}
            <p className="mt-1.5 text-ui-caption leading-snug text-ui-muted">
              {t("settings.stt.parakeetModelHint")}
            </p>
          </Field>

          {status?.provider === "parakeet" && (
            <p className="m-0 break-words text-ui-body text-primary">
              {status.text}
            </p>
          )}
        </ProviderCard>

        <ProviderCard
          title={t("settings.stt.qwen3Title")}
          statusText={
            localProgress.qwen3
              ? t("settings.stt.parakeetDownloading", {
                  index: localProgress.qwen3.fileIndex,
                  count: localProgress.qwen3.fileCount,
                })
              : localReady.qwen3
                ? t("settings.stt.parakeetDownloaded")
                : t("settings.stt.parakeetNotDownloaded")
          }
          configured={!!localReady.qwen3}
          active={cfg.sttProvider === "qwen3"}
          expanded={expandedStt === "qwen3"}
          onToggle={() =>
            setExpandedStt((prev) => (prev === "qwen3" ? null : "qwen3"))
          }
          // 未下载不允许切到本地引擎(否则录音转写必然失败)。
          onActivate={() => {
            if (localReady.qwen3) update("sttProvider", "qwen3");
          }}
        >
          <p className="text-ui-body leading-relaxed text-ui-muted">
            {t("settings.stt.qwen3Description")}
          </p>
          <Field label={t("settings.stt.qwen3ModelLabel")}>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void downloadLocal("qwen3", 6)}
                disabled={!!localProgress.qwen3}
              >
                <DownloadIcon className="size-4" />
                {localProgress.qwen3
                  ? t("settings.stt.parakeetDownloading", {
                      index: localProgress.qwen3.fileIndex,
                      count: localProgress.qwen3.fileCount,
                    })
                  : localReady.qwen3
                    ? t("settings.stt.parakeetRedownload")
                    : t("settings.stt.parakeetDownload")}
              </Button>
              {localReady.qwen3 && !localProgress.qwen3 && (
                <span className="flex items-center gap-1.5 text-ui-caption text-success">
                  <CheckIcon className="size-3.5" />
                  {t("settings.stt.parakeetDownloaded")}
                </span>
              )}
            </div>
            {localProgress.qwen3 && localProgress.qwen3.total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full bg-success transition-[width]"
                  style={{
                    width: `${Math.round(
                      (localProgress.qwen3.received /
                        localProgress.qwen3.total) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            )}
            <p className="mt-1.5 text-ui-caption leading-snug text-ui-muted">
              {t("settings.stt.parakeetModelHint")}
            </p>
          </Field>

          {status?.provider === "qwen3" && (
            <p className="m-0 break-words text-ui-body text-primary">
              {status.text}
            </p>
          )}
        </ProviderCard>
      </div>
    </section>
  );
}

// Learning-data backup: export everything (SQLite + profile MD + settings) to a
// single JSON file in Downloads; import fully replaces current data (confirmed,
// then the app reloads so every module re-reads the restored state). Keys are
// excluded — they are device-bound encrypted and never leave the machine.
function BackupSection() {
  const { t, locale } = useTranslation();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    if (busy) return;
    setBusy("export");
    setStatus(null);
    setError(null);
    try {
      // Fold the latest localStorage values into app_state first so the bundle
      // carries the freshest settings snapshot.
      await snapshotSettingsToMirror().catch(() => {});
      const { path } = await exportBackupToDownloads();
      setStatus(t("settings.backup.exported", { path }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleImportFile(file: File) {
    if (busy) return;
    setBusy("import");
    setStatus(null);
    setError(null);
    try {
      const raw = await file.text();
      const { bundle, summary } = parseBackupBundle(raw);
      const ok = await confirm({
        title: t("settings.backup.importConfirmTitle"),
        description: t("settings.backup.importConfirmDesc", {
          conversations: summary.conversations,
          turns: summary.turns,
          masteryItems: summary.masteryItems,
          date: summary.exportedAt
            ? new Date(summary.exportedAt).toLocaleString(locale)
            : "?",
        }),
        confirmText: t("settings.backup.importButton"),
      });
      if (!ok) return;
      await importBackupBundle(bundle);
      setStatus(t("settings.backup.imported"));
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <SettingRow label={t("settings.backup.exportLabel")}>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void handleExport()}
        >
          {busy === "export"
            ? t("settings.backup.exporting")
            : t("settings.backup.exportButton")}
        </Button>
      </SettingRow>
      <SettingRow label={t("settings.backup.importLabel")}>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "import"
            ? t("settings.backup.importing")
            : t("settings.backup.importButton")}
        </Button>
      </SettingRow>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />
      <p className="mt-2 text-ui-caption leading-snug text-ui-muted">
        {t("settings.backup.note")}
      </p>
      {status && (
        <p className="mt-2 break-all text-ui-body text-primary">{status}</p>
      )}
      {error && (
        <p className="mt-2 break-words text-ui-body text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const THEMES: { value: Theme; labelKey: MessageKey; icon: LucideIcon }[] = [
  { value: "light", labelKey: "settings.themes.light", icon: SunIcon },
  { value: "dark", labelKey: "settings.themes.dark", icon: MoonIcon },
  { value: "system", labelKey: "settings.themes.system", icon: MonitorIcon },
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

type BiLabel = { en: string; zh: string };
// Shared with the first-run onboarding wizard.
export const STUDY_LANGUAGES: { value: string; label: BiLabel }[] = [
  { value: "Chinese", label: { en: "Chinese", zh: "中文" } },
  { value: "English", label: { en: "English", zh: "英语" } },
  { value: "Japanese", label: { en: "Japanese", zh: "日语" } },
  { value: "Korean", label: { en: "Korean", zh: "韩语" } },
  { value: "Spanish", label: { en: "Spanish", zh: "西班牙语" } },
  { value: "French", label: { en: "French", zh: "法语" } },
  { value: "German", label: { en: "German", zh: "德语" } },
  { value: "Portuguese", label: { en: "Portuguese", zh: "葡萄牙语" } },
  { value: "Russian", label: { en: "Russian", zh: "俄语" } },
  { value: "Italian", label: { en: "Italian", zh: "意大利语" } },
];
export const LEVELS: { value: string; label: BiLabel }[] = [
  { value: "A1", label: { en: "A1 · Beginner", zh: "A1 · 入门" } },
  { value: "A2", label: { en: "A2 · Elementary", zh: "A2 · 初级" } },
  { value: "B1", label: { en: "B1 · Intermediate", zh: "B1 · 中级" } },
  { value: "B2", label: { en: "B2 · Upper-Intermediate", zh: "B2 · 中高级" } },
  { value: "C1", label: { en: "C1 · Advanced", zh: "C1 · 高级" } },
  { value: "C2", label: { en: "C2 · Mastery", zh: "C2 · 精通" } },
];

const CUSTOM_MODEL_VALUE = "__custom_model__";
export type SettingsSection =
  | "general"
  | "llm"
  | "stt"
  | "tts"
  | "commands"
  | "customize";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Each provider's brand icon (local SVG asset); colors follow ChatView's ModelLogo.
const PROVIDER_BRAND: Record<ProviderType, { svg: string; className: string }> =
  {
    openai: { svg: openAiLogo, className: "text-foreground" },
    gemini: { svg: geminiLogo, className: "text-brand" },
    anthropic: { svg: anthropicLogo, className: "text-info" },
    deepseek: { svg: deepSeekLogo, className: "text-brand" },
    openrouter: { svg: openRouterLogo, className: "text-foreground" },
    xai: { svg: grokLogo, className: "text-foreground" },
    mistral: { svg: mistralLogo, className: "text-info" },
    qwen: { svg: qwenLogo, className: "text-brand" },
    moonshot: { svg: kimiLogo, className: "text-foreground" },
    glm: { svg: chatglmLogo, className: "text-info" },
    minimax: { svg: minimaxLogo, className: "text-destructive" },
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

// A provider card in the list: the header shows status at a glance and carries
// the activation control on the right (a quiet "Use" button, or a check when
// active — Claude desktop style); expanding it reveals the configuration form.
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
  icon?: ReactNode;
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
    <div className="border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3 rounded-lg pr-3 transition-colors hover:bg-accent/40">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3.5 px-3 py-3.5 text-left"
        >
          {icon}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-ui-body font-medium">{title}</span>
            <span className="flex items-center gap-1.5 text-ui-caption text-ui-muted">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  configured ? "bg-success" : "bg-foreground/25",
                )}
              />
              <span className="truncate">{statusText}</span>
            </span>
          </span>
        </button>
        {active ? (
          <span className="flex shrink-0 items-center gap-1.5 text-ui-caption font-medium text-primary">
            <CheckIcon className="size-3.5" />
            {t("settings.card.inUse")}
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2.5 text-ui-caption"
            onClick={onActivate}
          >
            {t("settings.card.use")}
          </Button>
        )}
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-hidden
          className="shrink-0 p-1 text-ui-muted"
        >
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
      </div>

      {expanded && (
        <div className="ml-3 space-y-5 border-l border-border/50 pt-1 pb-6 pl-5">
          {children}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  // Icon-only, no container or background — the active choice is marked by color
  // alone (foreground vs muted). Labels live in aria-label/title for a11y.
  return (
    <div className="flex items-center gap-0.5">
      {THEMES.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            size="icon"
            aria-pressed={active}
            aria-label={t(opt.labelKey)}
            title={t(opt.labelKey)}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "size-8 hover:bg-transparent",
              active
                ? "text-foreground"
                : "text-ui-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
          </Button>
        );
      })}
    </div>
  );
}

function AccentSelect() {
  const { accent, setAccent } = useTheme();
  const { t } = useTranslation();
  return (
    <Select value={accent} onValueChange={(v) => setAccent(v as Accent)}>
      <SelectTrigger variant="ghost">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACCENTS.map((a) => (
          <SelectItem key={a.value} value={a.value}>
            <span className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ background: a.swatch }}
              />
              {t(a.labelKey)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LanguageSelect() {
  const { locale, setLocale, t } = useTranslation();
  return (
    <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
      <SelectTrigger variant="ghost">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GlassToggle() {
  const { glassEnabled, setGlassEnabled } = useTheme();
  const { t } = useTranslation();
  return (
    <ToggleField
      label={t("settings.general.glass")}
      checked={glassEnabled}
      onChange={setGlassEnabled}
    />
  );
}

// One macro's editor card: a /name header with a trailing action (reset / delete) and the fields below.
function MacroCard({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-ui-body font-semibold text-foreground">
          {title}
        </span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

type BuiltinForm = { description: string; argsHint: string; template: string };

function effectiveBuiltinForm(
  def: PromptMacroDef,
  ov: PromptMacroOverride | undefined,
): BuiltinForm {
  return {
    description: ov?.description ?? def.description,
    argsHint: ov?.argsHint ?? def.argsHint ?? "",
    template: ov?.template ?? def.template,
  };
}

// Store only the fields that differ from the default, so an untouched (or restored) built-in keeps no
// override and "Reset" disappears — and future default changes still flow through.
function diffFromDefault(
  def: PromptMacroDef,
  f: BuiltinForm,
): PromptMacroOverride {
  const p: PromptMacroOverride = {};
  if (f.description.trim() && f.description.trim() !== def.description)
    p.description = f.description;
  if (f.argsHint.trim() && f.argsHint.trim() !== (def.argsHint ?? ""))
    p.argsHint = f.argsHint;
  if (f.template.trim() && f.template !== def.template) p.template = f.template;
  return p;
}

// Editor for the customizable "/" prompt macros: edit the built-ins (reset to default) and add/remove
// custom ones. Persists to the prompt-macro store on every change (frontend localStorage); the chat menu
// recomputes from the store, so changes take effect without a reload.
function CommandsSettings() {
  const { t } = useTranslation();
  const [overrides, setOverrides] = useState(() => getPromptMacroOverrides());
  const [builtinForm, setBuiltinForm] = useState<Record<string, BuiltinForm>>(
    () => {
      const ov = getPromptMacroOverrides();
      const m: Record<string, BuiltinForm> = {};
      for (const def of BUILTIN_PROMPT_MACROS)
        m[def.name] = effectiveBuiltinForm(def, ov[def.name]);
      return m;
    },
  );
  const [custom, setCustom] = useState<CustomPromptMacro[]>(() =>
    getCustomPromptMacros().map((c) => ({ ...c })),
  );

  function editBuiltin(def: PromptMacroDef, patch: Partial<BuiltinForm>) {
    const next = { ...builtinForm[def.name], ...patch };
    setBuiltinForm((prev) => ({ ...prev, [def.name]: next }));
    setPromptMacroOverride(def.name, diffFromDefault(def, next));
    setOverrides(getPromptMacroOverrides());
  }

  function resetBuiltin(def: PromptMacroDef) {
    clearPromptMacroOverride(def.name);
    setOverrides(getPromptMacroOverrides());
    setBuiltinForm((prev) => ({
      ...prev,
      [def.name]: effectiveBuiltinForm(def, undefined),
    }));
  }

  function editCustom(id: string, patch: Partial<CustomPromptMacro>) {
    const next = custom.map((c) => (c.id === id ? { ...c, ...patch } : c));
    setCustom(next);
    const item = next.find((c) => c.id === id);
    if (item) upsertCustomPromptMacro(item);
  }

  function addCustom() {
    const taken = takenMacroNames(custom);
    let i = 1;
    while (taken.has(`custom${i}`)) i++;
    const macro: CustomPromptMacro = {
      id: crypto.randomUUID(),
      name: `custom${i}`,
      description: "",
      argsHint: "",
      template: "",
    };
    setCustom((prev) => [...prev, macro]);
    upsertCustomPromptMacro(macro);
  }

  function removeCustom(id: string) {
    deleteCustomPromptMacro(id);
    setCustom((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <section className="space-y-7">
      <div className="space-y-2 border-b border-border/70 pb-5">
        <h2 className="mt-0 text-ui-title font-semibold tracking-tight">
          {t("settings.commands.title")}
        </h2>
        <p className="max-w-2xl text-ui-body leading-relaxed text-ui-muted">
          {t("settings.commands.description")}
        </p>
      </div>

      <p className="max-w-2xl text-ui-body leading-relaxed text-ui-muted">
        {t("settings.commands.inputTokenHint")}
      </p>

      <div className="space-y-4">
        <h3 className="text-ui-meta font-semibold uppercase tracking-wide text-ui-muted">
          {t("settings.commands.builtinHeading")}
        </h3>
        {BUILTIN_PROMPT_MACROS.map((def) => {
          const f = builtinForm[def.name];
          const takesBody = f.template.includes(PROMPT_INPUT_TOKEN);
          return (
            <MacroCard
              key={def.name}
              title={`/${def.name}`}
              trailing={
                overrides[def.name] ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => resetBuiltin(def)}
                  >
                    <RotateCcwIcon className="size-3.5" />
                    {t("settings.commands.reset")}
                  </Button>
                ) : null
              }
            >
              <Field label={t("settings.commands.descriptionLabel")}>
                <Input
                  value={f.description}
                  onChange={(e) =>
                    editBuiltin(def, { description: e.target.value })
                  }
                />
              </Field>
              <Field label={t("settings.commands.promptLabel")}>
                <Textarea
                  className="min-h-24 resize-y font-mono leading-snug"
                  value={f.template}
                  onChange={(e) =>
                    editBuiltin(def, { template: e.target.value })
                  }
                />
              </Field>
              {takesBody && (
                <Field label={t("settings.commands.argsHintLabel")}>
                  <Input
                    value={f.argsHint}
                    onChange={(e) =>
                      editBuiltin(def, { argsHint: e.target.value })
                    }
                  />
                </Field>
              )}
            </MacroCard>
          );
        })}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-ui-meta font-semibold uppercase tracking-wide text-ui-muted">
            {t("settings.commands.customHeading")}
          </h3>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={addCustom}
          >
            <PlusIcon className="size-4" />
            {t("settings.commands.add")}
          </Button>
        </div>
        {custom.length === 0 && (
          <p className="text-ui-body text-ui-muted">
            {t("settings.commands.customEmpty")}
          </p>
        )}
        {custom.map((c) => {
          const takesBody = c.template.includes(PROMPT_INPUT_TOKEN);
          const nameNorm = c.name.trim().toLowerCase();
          const nameError = !isValidMacroName(c.name)
            ? t("settings.commands.nameInvalid")
            : takenMacroNames(custom, c.id).has(nameNorm)
              ? t("settings.commands.nameTaken")
              : null;
          return (
            <MacroCard
              key={c.id}
              title={`/${c.name.trim() || "…"}`}
              trailing={
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => removeCustom(c.id)}
                >
                  <Trash2Icon className="size-3.5" />
                  {t("settings.commands.delete")}
                </Button>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("settings.commands.nameLabel")}>
                  <Input
                    value={c.name}
                    onChange={(e) => editCustom(c.id, { name: e.target.value })}
                  />
                  {nameError && (
                    <span className="text-ui-caption text-destructive">
                      {nameError}
                    </span>
                  )}
                </Field>
                <Field label={t("settings.commands.descriptionLabel")}>
                  <Input
                    value={c.description ?? ""}
                    onChange={(e) =>
                      editCustom(c.id, { description: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label={t("settings.commands.promptLabel")}>
                <Textarea
                  className="min-h-24 resize-y font-mono leading-snug"
                  value={c.template}
                  onChange={(e) =>
                    editCustom(c.id, { template: e.target.value })
                  }
                  placeholder={t("settings.commands.promptPlaceholder")}
                />
              </Field>
              {takesBody && (
                <Field label={t("settings.commands.argsHintLabel")}>
                  <Input
                    value={c.argsHint ?? ""}
                    onChange={(e) =>
                      editCustom(c.id, { argsHint: e.target.value })
                    }
                  />
                </Field>
              )}
            </MacroCard>
          );
        })}
      </div>
    </section>
  );
}

// Self-contained host for the free-form AI-customization panel, surfaced in
// Settings (the same panel also lives in the Profile page). Loads the profile
// MD, edits only its "AI preferences" section, and persists on blur / smart-apply.
function AiCustomizeSettings() {
  const { t } = useTranslation();
  const [md, setMd] = useState("");
  const [savedMd, setSavedMd] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [smartDraft, setSmartDraft] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    readProfile(loadConfig()).then((m) => {
      if (!alive) return;
      setMd(m);
      setSavedMd(m);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const preferences = useMemo(() => preferencesFromProfile(md || ""), [md]);

  // Refs so the unmount flush always sees the latest unsaved edits.
  const mdRef = useRef("");
  mdRef.current = md;
  const savedMdRef = useRef("");
  savedMdRef.current = savedMd;
  const loadedRef = useRef(false);
  loadedRef.current = loaded;

  // Flush unsaved per-scope edits when navigating away from Settings.
  useEffect(
    () => () => {
      if (loadedRef.current && mdRef.current !== savedMdRef.current) {
        void writeProfile(mdRef.current);
      }
    },
    [],
  );

  function updatePreference(scope: PreferenceScope, body: string) {
    if (!loaded) return;
    setMd((cur) => updateProfilePreference(cur, scope, body));
  }

  async function saveIfDirty() {
    if (!loaded || mdRef.current === savedMdRef.current) return;
    const next = mdRef.current;
    await writeProfile(next);
    setSavedMd(next);
  }

  async function applySmart() {
    const instruction = smartDraft.trim();
    if (!loaded || !instruction) return;
    setSmartBusy(true);
    setStatus(t("profile.aiClassifyingStatus"));
    try {
      await writeProfile(mdRef.current);
      const next = await applyProfilePreferenceInstruction(
        instruction,
        mdRef.current,
      );
      await writeProfile(next);
      setMd(next);
      setSavedMd(next);
      setSmartDraft("");
      setStatus(t("profile.classifiedStatus"));
    } catch (e) {
      setStatus(
        t("profile.classifyFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setSmartBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <PreferencesPanel
        preferences={preferences}
        smartDraft={smartDraft}
        smartBusy={smartBusy}
        variant="plain"
        onSmartDraftChange={setSmartDraft}
        onSmartApply={() => void applySmart()}
        onScopeChange={updatePreference}
        onScopeBlur={() => void saveIfDirty()}
      />
      {status && (
        <p className="m-0 text-ui-body text-ui-muted" role="status">
          {status}
        </p>
      )}
    </section>
  );
}

export function SettingsView({ section }: { section: SettingsSection }) {
  const { t, locale } = useTranslation();
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
    deepseek: "sk-…",
    openrouter: "sk-or-…",
    xai: "xai-…",
    mistral: "…",
    qwen: "sk-…",
    moonshot: "sk-…",
    glm: "…",
    minimax: "eyJ…",
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
      jsonObjectFallback: undefined,
      customModels: undefined,
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
      let text = t("settings.llm.testOk", {
        sample: gen.trim().slice(0, 40),
        count: streamed.length,
      });
      // A custom model id that just verified successfully gets saved to the list so it can be reselected later.
      const entry = cfg.providers[type];
      const model = entry.model.trim();
      if (model && !findModelOption(type, entry, model)) {
        updateProvider(type, {
          customModels: [...(entry.customModels ?? []), model],
        });
        setCustomModel((prev) => ({ ...prev, [type]: false }));
        text += ` ${t("settings.llm.modelAdded", { model })}`;
      }
      setLlmStatus({ type, text });
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
    const selectedModel = findModelOption(type, entry, entry.model);
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
              {providerModels(type, entry).map((model) => (
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

        {isOpenAIWireProvider(type) && (
          <div className="space-y-1.5">
            <ToggleField
              label={t("settings.llm.jsonObjectFallback")}
              checked={effectiveJsonObjectFallback(type, entry)}
              onChange={(v) => updateProvider(type, { jsonObjectFallback: v })}
            />
            <p className="text-ui-caption text-ui-muted">
              {t("settings.llm.jsonObjectFallbackHint")}
            </p>
          </div>
        )}

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
            <p className="mt-1.5 text-ui-caption leading-snug text-ui-muted">
              {t("settings.llm.keyStorageNote")}
            </p>
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

            <div>
              <SettingRow label={t("settings.general.interfaceLanguage")}>
                <LanguageSelect />
              </SettingRow>
              <SettingRow label={t("settings.general.theme")}>
                <ThemeToggle />
              </SettingRow>
              <SettingRow label={t("settings.general.accent")}>
                <AccentSelect />
              </SettingRow>
              {!isWindows() && <GlassToggle />}
            </div>

            <div>
              <SettingRow label={t("settings.general.nativeLanguage")}>
                <Select
                  value={cfg.nativeLanguage}
                  onValueChange={(v) => update("nativeLanguage", v)}
                >
                  <SelectTrigger variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDY_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label[locale]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label={t("settings.general.targetLanguage")}>
                <Select
                  value={cfg.targetLanguage}
                  onValueChange={(v) => update("targetLanguage", v)}
                >
                  <SelectTrigger variant="ghost">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDY_LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label[locale]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow label={t("settings.general.level")}>
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
                        {l.label[locale]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <ToggleField
                label={t("settings.general.autoBilingual")}
                checked={cfg.autoBilingual}
                onChange={(v) => update("autoBilingual", v)}
              />
              <ToggleField
                label={t("settings.general.actionLabels")}
                checked={cfg.actionLabels}
                onChange={(v) => update("actionLabels", v)}
              />
              <ToggleField
                label={t("settings.general.inputHintsAuto")}
                checked={cfg.inputHintsAuto}
                onChange={(v) => update("inputHintsAuto", v)}
              />
            </div>

            <BackupSection />

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

            <div className="flex flex-col">
              {PROVIDER_TYPES.map(renderLlmCard)}
            </div>
          </section>
        )}

        {section === "stt" && <SttSettings />}

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
              label={t("settings.tts.autoSpeak")}
              checked={ttsCfg.autoSpeak}
              onChange={(v) => updateTts("autoSpeak", v)}
            />

            <div className="flex flex-col">
              <ProviderCard
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

        {section === "commands" && <CommandsSettings />}

        {section === "customize" && <AiCustomizeSettings />}
      </div>
    </div>
  );
}
