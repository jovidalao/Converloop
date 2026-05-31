import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type AppConfig,
  apiKeyAccount,
  getProvider,
  loadConfig,
  PROVIDER_PRESETS,
  type ProviderType,
  saveConfig,
} from "../config";
import { deleteSecret, getSecret, setSecret } from "../keychain";
import {
  loadTtsConfig,
  MIMO_TTS_KEY_ACCOUNT,
  MIMO_VOICES,
  saveTtsConfig,
  type TtsConfig,
} from "../tts/config";
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
      <span className="text-sm text-muted-foreground">{label}</span>
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
    <label className="mb-3.5 flex cursor-pointer items-center gap-2.5 text-sm">
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
            "rounded-sm px-3 py-1 text-sm transition-colors",
            theme === t.value
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsView() {
  const [cfg, setCfg] = useState<AppConfig>(loadConfig());
  const [ttsCfg, setTtsCfg] = useState<TtsConfig>(loadTtsConfig());
  const [hasKey, setHasKey] = useState(false);
  const [hasTtsKey, setHasTtsKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [ttsKeyInput, setTtsKeyInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [ttsCacheCount, setTtsCacheCount] = useState<number | null>(null);
  const [clearingTtsCache, setClearingTtsCache] = useState(false);

  const keyAccount = apiKeyAccount(cfg.providerType);
  const preset = PROVIDER_PRESETS[cfg.providerType];

  const baseUrlLabels: Record<ProviderType, string> = {
    openai: "Base URL (OpenAI 兼容)",
    gemini: "Base URL (Gemini 原生 API)",
    anthropic: "Base URL (Anthropic)",
  };

  const keyPlaceholders: Record<ProviderType, string> = {
    openai: "sk-…",
    gemini: "AIza…",
    anthropic: "sk-ant-…",
  };

  useEffect(() => {
    getSecret(apiKeyAccount(cfg.providerType)).then((k) => setHasKey(!!k));
    getSecret(MIMO_TTS_KEY_ACCOUNT).then((k) => setHasTtsKey(!!k));
    void getTtsCacheCount().then(setTtsCacheCount);
  }, [cfg.providerType]);

  function update<K extends keyof AppConfig>(k: K, v: AppConfig[K]) {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    saveConfig(next);
  }

  function setProviderType(type: ProviderType) {
    const p = PROVIDER_PRESETS[type];
    const next: AppConfig = {
      ...cfg,
      providerType: type,
      baseUrl: p.baseUrl,
      model: p.model,
    };
    setCfg(next);
    saveConfig(next);
  }

  async function saveKey() {
    if (!keyInput.trim()) return;
    await setSecret(keyAccount, keyInput.trim());
    setKeyInput("");
    setHasKey(true);
    setStatus("API key 已加密保存到本地。");
  }

  async function clearKey() {
    await deleteSecret(keyAccount);
    setHasKey(false);
    setStatus("API key 已从本地清除。");
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
    setTtsStatus("MiMo TTS API key 已加密保存到本地。");
  }

  async function clearTtsKey() {
    await deleteSecret(MIMO_TTS_KEY_ACCOUNT);
    setHasTtsKey(false);
    setTtsStatus("MiMo TTS API key 已从本地清除。");
  }

  async function testTts() {
    setTestingTts(true);
    setTtsStatus(null);
    try {
      const apiKey = await getSecret(MIMO_TTS_KEY_ACCOUNT);
      if (!apiKey) {
        setTtsStatus("还没有 MiMo TTS API key。");
        return;
      }
      const audio = await synthesizeMimo({
        apiKey,
        baseUrl: ttsCfg.baseUrl,
        model: ttsCfg.model,
        voice: ttsCfg.voice,
        stylePrompt: ttsCfg.stylePrompt,
        text: "Hello, this is a test.",
      });
      setTtsStatus(`✓ TTS 正常 — 收到 ${audio.byteLength} 字节音频`);
    } catch (e) {
      setTtsStatus(`✗ 失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestingTts(false);
    }
  }

  async function handleClearTtsCache() {
    setClearingTtsCache(true);
    setTtsStatus(null);
    try {
      const removed = await clearTtsCache();
      setTtsCacheCount(0);
      setTtsStatus(`✓ 已清空朗读缓存(${removed} 条)`);
    } catch (e) {
      setTtsStatus(
        `✗ 清空缓存失败:${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setClearingTtsCache(false);
    }
  }

  // Task 2 验收:同一个 key 跑通 generate(非流式)和 stream(流式)。
  async function testConnection() {
    setTesting(true);
    setStatus(null);
    try {
      const provider = await getProvider();
      if (!provider) {
        setStatus("还没有 API key。");
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
      setStatus(
        `✓ 连接正常 — 非流式: "${gen.trim().slice(0, 40)}" | 流式收到 ${streamed.length} 字符`,
      );
    } catch (e) {
      setStatus(`✗ 失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="h-full max-w-2xl overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mb-4 mt-0 text-lg font-semibold tracking-tight">设置</h2>

      <Field label="主题">
        <ThemeToggle />
      </Field>

      <Field label="Provider">
        <Select
          value={cfg.providerType}
          onValueChange={(v) => setProviderType(v as ProviderType)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {PROVIDER_PRESETS[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label={baseUrlLabels[cfg.providerType]}>
        <Input
          value={cfg.baseUrl}
          onChange={(e) => update("baseUrl", e.target.value)}
          placeholder={preset.baseUrl}
        />
      </Field>
      <Field label="模型">
        <Input
          value={cfg.model}
          onChange={(e) => update("model", e.target.value)}
        />
      </Field>

      <div className="mb-3.5 flex items-end gap-2">
        <Field label="母语" className="mb-0 flex-1">
          <Input
            value={cfg.nativeLanguage}
            onChange={(e) => update("nativeLanguage", e.target.value)}
          />
        </Field>
        <Field label="目标语言" className="mb-0 flex-1">
          <Input
            value={cfg.targetLanguage}
            onChange={(e) => update("targetLanguage", e.target.value)}
          />
        </Field>
        <Field label="水平" className="mb-0 flex-1">
          <Input
            value={cfg.level}
            onChange={(e) => update("level", e.target.value)}
          />
        </Field>
      </div>

      <Field label={`API key ${hasKey ? "(已保存 · 留空不改)" : "(未设置)"}`}>
        <div className="flex items-end gap-2">
          <Input
            type="password"
            className="flex-1"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={
              hasKey ? "••••••••" : keyPlaceholders[cfg.providerType]
            }
          />
          <Button onClick={saveKey} disabled={!keyInput.trim()}>
            保存 key
          </Button>
          {hasKey && (
            <Button variant="secondary" onClick={clearKey}>
              清除
            </Button>
          )}
        </div>
      </Field>

      <ToggleField
        checked={cfg.autoBilingual}
        onChange={(v) => update("autoBilingual", v)}
      >
        AI 回复自动开启双语阅读(逐句对照)
      </ToggleField>

      <Button variant="secondary" onClick={testConnection} disabled={testing}>
        {testing ? "测试中…" : "测试连接(流式 + 非流式)"}
      </Button>

      {status && (
        <p className="mt-2 break-words text-sm text-primary">{status}</p>
      )}

      <div className="my-6 h-px bg-border" />

      <h2 className="mb-2 mt-0 text-lg font-semibold tracking-tight">
        朗读 (MiMo TTS)
      </h2>
      <p className="-mt-1 mb-4 text-sm leading-snug text-muted-foreground">
        聊天中 AI 回复、改正和更地道句子旁的小喇叭会调用 MiMo
        语音合成。相同句子会缓存音频,避免重复请求。
        {ttsCacheCount !== null && ` 当前缓存 ${ttsCacheCount} 条。`}
      </p>

      <ToggleField
        checked={ttsCfg.autoSpeak}
        onChange={(v) => updateTts("autoSpeak", v)}
      >
        AI 回复自动朗读(关掉后仍可点小喇叭手动朗读)
      </ToggleField>

      <Field
        label={`MiMo API key ${hasTtsKey ? "(已保存 · 留空不改)" : "(未设置)"}`}
      >
        <div className="flex items-end gap-2">
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
            <Button variant="secondary" onClick={() => void clearTtsKey()}>
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

      <div className="mb-3.5 flex items-end gap-2">
        <Field label="音色" className="mb-0 flex-1">
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
        <Field label="模型" className="mb-0 flex-1">
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => void testTts()}
          disabled={testingTts}
        >
          {testingTts ? "测试中…" : "测试朗读"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleClearTtsCache()}
          disabled={clearingTtsCache || ttsCacheCount === 0}
        >
          {clearingTtsCache ? "清空中…" : "清空朗读缓存"}
        </Button>
      </div>

      {ttsStatus && (
        <p className="mt-2 break-words text-sm text-primary">{ttsStatus}</p>
      )}
    </div>
  );
}
