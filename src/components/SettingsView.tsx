import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import claudeLogo from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import { ChevronDownIcon, SparklesIcon, Volume2Icon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { type Theme, useTheme } from "./theme-provider";
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

// 表单字段:标签 + 控件。row 里用 flex-1 让字段等宽分布。
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
    <div className={cn("mb-3.5 flex flex-col gap-1.5", className)}>
      <span className="text-ui-body text-ui-muted">{label}</span>
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
    <label className="mb-3.5 flex items-center gap-2.5 text-ui-body">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "明亮" },
  { value: "dark", label: "暗黑" },
  { value: "system", label: "跟随系统" },
];
const CUSTOM_MODEL_VALUE = "__custom_model__";
export type SettingsSection = "general" | "llm" | "tts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 每个 provider 的品牌图标(本地 SVG 资产),配色沿用 ChatView 的 ModelLogo。
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

// 列表里的 provider 卡片:头部一眼看清「使用中 / 已配置」状态,展开后是该 provider 的配置表单。
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
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        active ? "border-primary/60 bg-primary/[0.03]" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/40"
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-ui-body font-medium">{title}</span>
            {active && (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-ui-micro font-medium text-primary-foreground">
                使用中
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
          {configured ? "已配置" : "未配置"}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-ui-muted transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="border-t px-3.5 pt-3.5 pb-1">
          {active ? (
            <p className="mb-3.5 text-ui-caption text-ui-muted">
              ✓ 这是当前正在使用的 provider。
            </p>
          ) : (
            <Button size="sm" className="mb-3.5" onClick={onActivate}>
              设为当前 provider
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="inline-flex w-fit rounded-md border p-0.5">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => setTheme(t.value)}
          className={cn(
            "rounded-sm px-3 py-1 text-ui-body transition-colors",
            theme === t.value
              ? "bg-accent text-foreground"
              : "text-ui-muted hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView({ section }: { section: SettingsSection }) {
  const [cfg, setCfg] = useState<AppConfig>(loadConfig);
  const [ttsCfg, setTtsCfg] = useState<TtsConfig>(loadTtsConfig());

  // 一次性加载全部 provider 的配置状态(有无 key / 是否已登录),好让每张卡片直接显示。
  const [keyStatus, setKeyStatus] = useState<
    Partial<Record<ProviderType, boolean>>
  >({});
  const [oauthTokens, setOauthTokens] = useState<
    Partial<Record<ProviderType, OAuthTokens | null>>
  >({});
  const [hasTtsKey, setHasTtsKey] = useState(false);

  // 单开手风琴:默认展开当前 provider。
  const [expandedLlm, setExpandedLlm] = useState<ProviderType | null>(
    () => loadConfig().providerType,
  );
  const [expandedTts, setExpandedTts] = useState<TtsProvider | null>(
    () => loadTtsConfig().ttsProvider,
  );

  const [keyInputs, setKeyInputs] = useState<
    Partial<Record<ProviderType, string>>
  >({});
  // 用户在某 provider 上显式选了「自定义模型」(即使当前 model 还命中预设)。
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

  const baseUrlLabels: Record<ProviderType, string> = {
    openai: "Base URL (OpenAI 兼容)",
    gemini: "Base URL (Gemini 原生 API)",
    anthropic: "Base URL (Anthropic)",
    "claude-oauth": "Base URL (Anthropic 官方)",
    "codex-oauth": "Base URL (ChatGPT Codex 后端)",
  };
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

  // 改某个 provider 的连接配置(不影响其它 provider,也不一定是当前激活的那个)。
  function updateProvider(t: ProviderType, patch: Partial<ProviderSettings>) {
    const next: AppConfig = {
      ...cfg,
      providers: { ...cfg.providers, [t]: { ...cfg.providers[t], ...patch } },
    };
    setCfg(next);
    saveConfig(next);
  }

  function selectModel(t: ProviderType, value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      setCustomModel((prev) => ({ ...prev, [t]: true }));
      return;
    }
    setCustomModel((prev) => ({ ...prev, [t]: false }));
    updateProvider(t, { model: value });
  }

  function resetToPreset(t: ProviderType) {
    const p = PROVIDER_PRESETS[t];
    setCustomModel((prev) => ({ ...prev, [t]: false }));
    updateProvider(t, {
      baseUrl: p.baseUrl,
      model: p.model,
      contextTokens: undefined,
    });
  }

  async function saveKey(t: ProviderType) {
    const v = (keyInputs[t] ?? "").trim();
    if (!v) return;
    await setSecret(apiKeyAccount(t), v);
    setKeyInputs((prev) => ({ ...prev, [t]: "" }));
    setKeyStatus((prev) => ({ ...prev, [t]: true }));
    setLlmStatus({ type: t, text: "API key 已加密保存到本地。" });
  }

  async function clearKey(t: ProviderType) {
    await deleteSecret(apiKeyAccount(t));
    setKeyStatus((prev) => ({ ...prev, [t]: false }));
    setLlmStatus({ type: t, text: "API key 已从本地清除。" });
  }

  function loginForProvider(type: ProviderType): Promise<OAuthTokens> {
    if (type === "claude-oauth") return loginAnthropic();
    if (type === "codex-oauth") return loginOpenAICodex();
    throw new Error("该 provider 暂不支持订阅登录");
  }

  async function handleOauthLogin(t: ProviderType) {
    setLoggingIn(t);
    setLlmStatus(null);
    try {
      const tokens = await loginForProvider(t);
      await setTokens(oauthAccount(t), tokens);
      setOauthTokens((prev) => ({ ...prev, [t]: tokens }));
      setLlmStatus({ type: t, text: "✓ 登录成功,令牌已加密保存到本地。" });
    } catch (e) {
      setLlmStatus({ type: t, text: `✗ 登录失败:${errText(e)}` });
    } finally {
      setLoggingIn(null);
    }
  }

  async function handleOauthLogout(t: ProviderType) {
    await clearTokens(oauthAccount(t));
    setOauthTokens((prev) => ({ ...prev, [t]: null }));
    setLlmStatus({ type: t, text: "已退出登录,令牌已清除。" });
  }

  // 同一个 key 跑通 generate(非流式)和 stream(流式),针对这张卡片的 provider。
  async function testConnection(t: ProviderType) {
    setTestingLlm(t);
    setLlmStatus(null);
    try {
      const provider = await getProviderFor(t);
      if (!provider) {
        setLlmStatus({ type: t, text: "还没有 API key / 未登录。" });
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
        type: t,
        text: `✓ 连接正常 — 非流式: "${gen.trim().slice(0, 40)}" | 流式收到 ${streamed.length} 字符`,
      });
    } catch (e) {
      setLlmStatus({ type: t, text: `✗ 失败:${errText(e)}` });
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
      text: "MiMo TTS API key 已加密保存到本地。",
    });
  }

  async function clearTtsKey() {
    await deleteSecret(MIMO_TTS_KEY_ACCOUNT);
    setHasTtsKey(false);
    setTtsStatus({ provider: "mimo", text: "MiMo TTS API key 已从本地清除。" });
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
          setTtsStatus({ provider, text: "还没有 MiMo TTS API key。" });
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
        text: `✓ TTS 正常 — 收到 ${audio.byteLength} 字节音频`,
      });
    } catch (e) {
      setTtsStatus({ provider, text: `✗ 失败:${errText(e)}` });
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
      setCacheStatus(`✓ 已清空朗读缓存(${removed} 条)`);
    } catch (e) {
      setCacheStatus(`✗ 清空缓存失败:${errText(e)}`);
    } finally {
      setClearingTtsCache(false);
    }
  }

  function renderLlmCard(t: ProviderType) {
    const entry = cfg.providers[t];
    const preset = PROVIDER_PRESETS[t];
    const oauth = isOAuthProvider(t);
    const tokens = oauthTokens[t] ?? null;
    const hasKey = !!keyStatus[t];
    const configured = oauth ? !!tokens : hasKey;
    const selectedModel = findProviderModelOption(t, entry.model);
    const isCustom = (customModel[t] ?? false) || !selectedModel;
    const modelValue =
      isCustom || !selectedModel ? CUSTOM_MODEL_VALUE : selectedModel.model;
    const statusText = oauth
      ? tokens
        ? "已登录 · 订阅令牌"
        : "未登录 · 需浏览器订阅登录"
      : hasKey
        ? "API key 已保存"
        : "未设置 API key";

    return (
      <ProviderCard
        key={t}
        icon={<ProviderBrandIcon type={t} />}
        title={preset.label}
        statusText={statusText}
        configured={configured}
        active={cfg.providerType === t}
        expanded={expandedLlm === t}
        onToggle={() => setExpandedLlm((prev) => (prev === t ? null : t))}
        onActivate={() => update("providerType", t)}
      >
        <Field label={baseUrlLabels[t]}>
          <Input
            value={entry.baseUrl}
            onChange={(e) => updateProvider(t, { baseUrl: e.target.value })}
            placeholder={preset.baseUrl}
          />
        </Field>

        <Field label="模型">
          <Select value={modelValue} onValueChange={(v) => selectModel(t, v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {preset.models.map((model) => (
                <SelectItem key={model.model} value={model.model}>
                  {providerModelLabel(t, model.model)}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_MODEL_VALUE}>
                {preset.shortLabel} · 自定义模型
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {isCustom ? (
          <Field label="自定义模型 ID">
            <Input
              value={entry.model}
              onChange={(e) => {
                setCustomModel((prev) => ({ ...prev, [t]: true }));
                updateProvider(t, { model: e.target.value });
              }}
              placeholder={preset.model}
            />
          </Field>
        ) : (
          selectedModel && (
            <p className="-mt-2 mb-3.5 break-all text-ui-caption text-ui-muted">
              模型 ID: {selectedModel.model}
            </p>
          )
        )}

        <Field label="上下文窗口 (token · 留空自动按模型推断)">
          <Input
            type="number"
            value={entry.contextTokens ?? ""}
            onChange={(e) => {
              const n = Number(e.target.value);
              updateProvider(t, {
                contextTokens: e.target.value.trim() && n > 0 ? n : undefined,
              });
            }}
            placeholder={`自动:${inferContextLimit(entry.model).toLocaleString()}`}
          />
        </Field>

        {oauth ? (
          <div className="mb-3.5 flex flex-col gap-2">
            <span className="text-ui-body text-ui-muted">
              订阅登录 {tokens ? "· 已登录" : "· 未登录"}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleOauthLogin(t)}
                disabled={loggingIn === t}
              >
                {loggingIn === t
                  ? "等待浏览器授权…"
                  : tokens
                    ? "重新登录"
                    : "用浏览器登录"}
              </Button>
              {tokens && (
                <Button
                  variant="secondary"
                  onClick={() => void handleOauthLogout(t)}
                >
                  退出登录
                </Button>
              )}
            </div>
            {tokens && (
              <span className="text-ui-caption text-ui-muted">
                访问令牌将于 {new Date(tokens.expires).toLocaleString()}{" "}
                前自动刷新。
              </span>
            )}
            <span className="text-ui-caption leading-snug text-ui-muted">
              ⚠️ 第三方应用使用订阅令牌(claude.ai / ChatGPT)可能违反对应
              服务条款、存在账号被标记风险;为你自有账号、请知悉后自担。
            </span>
          </div>
        ) : (
          <Field
            label={`API key ${hasKey ? "(已保存 · 留空不改)" : "(未设置)"}`}
          >
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="password"
                className="flex-1"
                value={keyInputs[t] ?? ""}
                onChange={(e) =>
                  setKeyInputs((prev) => ({ ...prev, [t]: e.target.value }))
                }
                placeholder={hasKey ? "••••••••" : keyPlaceholders[t]}
              />
              <Button
                onClick={() => void saveKey(t)}
                disabled={!(keyInputs[t] ?? "").trim()}
              >
                保存 key
              </Button>
              {hasKey && (
                <Button variant="secondary" onClick={() => void clearKey(t)}>
                  清除
                </Button>
              )}
            </div>
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => void testConnection(t)}
            disabled={testingLlm === t}
          >
            {testingLlm === t ? "测试中…" : "测试连接(流式 + 非流式)"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => resetToPreset(t)}>
            恢复预设
          </Button>
        </div>

        {llmStatus?.type === t && (
          <p className="mt-2 break-words text-ui-body text-primary">
            {llmStatus.text}
          </p>
        )}
      </ProviderCard>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 pt-14 pb-6">
      <div className="max-w-3xl">
        {section === "general" && (
          <section>
            <h2 className="mb-4 mt-0 text-ui-title font-semibold tracking-tight">
              通用设置
            </h2>

            <Field label="主题">
              <ThemeToggle />
            </Field>

            <div className="mb-3.5 flex flex-wrap items-end gap-2">
              <Field label="母语" className="mb-0 min-w-28 flex-1">
                <Input
                  value={cfg.nativeLanguage}
                  onChange={(e) => update("nativeLanguage", e.target.value)}
                />
              </Field>
              <Field label="目标语言" className="mb-0 min-w-28 flex-1">
                <Input
                  value={cfg.targetLanguage}
                  onChange={(e) => update("targetLanguage", e.target.value)}
                />
              </Field>
              <Field label="水平" className="mb-0 min-w-28 flex-1">
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
              AI 回复自动开启双语阅读(逐句对照)
            </ToggleField>
          </section>
        )}

        {section === "llm" && (
          <section>
            <h2 className="mb-1 mt-0 text-ui-title font-semibold tracking-tight">
              LLM 提供商
            </h2>
            <p className="mb-4 text-ui-body leading-snug text-ui-muted">
              下面列出全部提供商,每个都可单独配置并保存。点开任意一个修改连接信息,
              「设为当前 provider」决定聊天实际使用哪个。
            </p>

            <div className="flex flex-col gap-2.5">
              {PROVIDER_TYPES.map(renderLlmCard)}
            </div>
          </section>
        )}

        {section === "tts" && (
          <section>
            <h2 className="mb-1 mt-0 text-ui-title font-semibold tracking-tight">
              TTS 提供商
            </h2>
            <p className="mb-4 text-ui-body leading-snug text-ui-muted">
              聊天中 AI
              回复、改正和更地道句子旁的小喇叭会调用语音合成。相同句子会缓存音频,避免重复请求。
              {ttsCacheCount !== null && ` 当前缓存 ${ttsCacheCount} 条。`}
            </p>

            <ToggleField
              checked={ttsCfg.autoSpeak}
              onChange={(v) => updateTts("autoSpeak", v)}
            >
              AI 回复自动朗读(关掉后仍可点小喇叭手动朗读)
            </ToggleField>

            <div className="flex flex-col gap-2.5">
              <ProviderCard
                icon={<SparklesIcon className="size-5 shrink-0 text-brand" />}
                title="MiMo(神经语音 · 需 API key)"
                statusText={hasTtsKey ? "API key 已保存" : "未设置 API key"}
                configured={hasTtsKey}
                active={ttsCfg.ttsProvider === "mimo"}
                expanded={expandedTts === "mimo"}
                onToggle={() =>
                  setExpandedTts((prev) => (prev === "mimo" ? null : "mimo"))
                }
                onActivate={() => updateTts("ttsProvider", "mimo")}
              >
                <Field
                  label={`MiMo API key ${hasTtsKey ? "(已保存 · 留空不改)" : "(未设置)"}`}
                >
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      type="password"
                      className="flex-1"
                      value={ttsKeyInput}
                      onChange={(e) => setTtsKeyInput(e.target.value)}
                      placeholder={hasTtsKey ? "••••••••" : "MiMo API key…"}
                    />
                    <Button
                      onClick={() => void saveTtsKey()}
                      disabled={!ttsKeyInput.trim()}
                    >
                      保存 key
                    </Button>
                    {hasTtsKey && (
                      <Button
                        variant="secondary"
                        onClick={() => void clearTtsKey()}
                      >
                        清除
                      </Button>
                    )}
                  </div>
                </Field>

                <Field label="朗读风格 prompt (user 消息)">
                  <Textarea
                    className="min-h-18 resize-y leading-snug"
                    value={ttsCfg.stylePrompt}
                    onChange={(e) => updateTts("stylePrompt", e.target.value)}
                    rows={3}
                    placeholder="描述朗读的语气、语速、情感…"
                  />
                </Field>

                <div className="mb-3.5 flex flex-wrap items-end gap-2">
                  <Field label="音色" className="mb-0 min-w-28 flex-1">
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
                  <Field label="模型" className="mb-0 min-w-28 flex-1">
                    <Input
                      value={ttsCfg.model}
                      onChange={(e) => updateTts("model", e.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Base URL">
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
                  {testingTts === "mimo" ? "测试中…" : "测试朗读"}
                </Button>
                {ttsStatus?.provider === "mimo" && (
                  <p className="mt-2 break-words text-ui-body text-primary">
                    {ttsStatus.text}
                  </p>
                )}
              </ProviderCard>

              <ProviderCard
                icon={<Volume2Icon className="size-5 shrink-0 text-info" />}
                title="微软 Edge(免费 · 无需 key)"
                statusText="免费可用 · 无需 API key"
                configured
                active={ttsCfg.ttsProvider === "edge"}
                expanded={expandedTts === "edge"}
                onToggle={() =>
                  setExpandedTts((prev) => (prev === "edge" ? null : "edge"))
                }
                onActivate={() => updateTts("ttsProvider", "edge")}
              >
                <p className="mb-3.5 text-ui-body leading-snug text-ui-muted">
                  使用微软 Edge 在线神经语音,免费、无需 API key(合成走本地后端
                  WebSocket)。
                </p>
                <div className="mb-3.5 flex flex-wrap items-end gap-2">
                  <Field label="音色" className="mb-0 min-w-40 flex-1">
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
                  <Field label="语速" className="mb-0 min-w-24 flex-1">
                    <Input
                      value={ttsCfg.edgeRate}
                      onChange={(e) => updateTts("edgeRate", e.target.value)}
                      placeholder="+0%"
                    />
                  </Field>
                  <Field label="音高" className="mb-0 min-w-24 flex-1">
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
                  {testingTts === "edge" ? "测试中…" : "测试朗读"}
                </Button>
                {ttsStatus?.provider === "edge" && (
                  <p className="mt-2 break-words text-ui-body text-primary">
                    {ttsStatus.text}
                  </p>
                )}
              </ProviderCard>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => void handleClearTtsCache()}
                disabled={clearingTtsCache || ttsCacheCount === 0}
              >
                {clearingTtsCache ? "清空中…" : "清空朗读缓存"}
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
