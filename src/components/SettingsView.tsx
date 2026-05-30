import { useEffect, useState } from "react";
import {
  loadConfig,
  saveConfig,
  getProvider,
  apiKeyAccount,
  PROVIDER_PRESETS,
  type AppConfig,
  type ProviderType,
} from "../config";
import { getSecret, setSecret, deleteSecret } from "../keychain";
import {
  loadTtsConfig,
  saveTtsConfig,
  MIMO_TTS_KEY_ACCOUNT,
  MIMO_VOICES,
  type TtsConfig,
} from "../tts/config";
import { synthesizeMimo } from "../tts/mimo";
import { clearTtsCache, getTtsCacheCount } from "../tts/speak";

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
    setStatus("API key 已保存到 OS keychain。");
  }

  async function clearKey() {
    await deleteSecret(keyAccount);
    setHasKey(false);
    setStatus("API key 已从 keychain 清除。");
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
    setTtsStatus("MiMo TTS API key 已保存到 OS keychain。");
  }

  async function clearTtsKey() {
    await deleteSecret(MIMO_TTS_KEY_ACCOUNT);
    setHasTtsKey(false);
    setTtsStatus("MiMo TTS API key 已从 keychain 清除。");
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
      setTtsStatus("✗ 失败:" + (e instanceof Error ? e.message : String(e)));
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
      setTtsStatus("✗ 清空缓存失败:" + (e instanceof Error ? e.message : String(e)));
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
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
      });
      let streamed = "";
      await provider.stream(
        { messages: [{ role: "user", content: "Count from 1 to 5." }] },
        (d) => {
          streamed += d;
        },
      );
      setStatus(`✓ 连接正常 — 非流式: "${gen.trim().slice(0, 40)}" | 流式收到 ${streamed.length} 字符`);
    } catch (e) {
      setStatus("✗ 失败:" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="form">
      <h2>设置</h2>

      <div className="field">
        <label>Provider</label>
        <select
          value={cfg.providerType}
          onChange={(e) => setProviderType(e.target.value as ProviderType)}
        >
          {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map((t) => (
            <option key={t} value={t}>
              {PROVIDER_PRESETS[t].label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>{baseUrlLabels[cfg.providerType]}</label>
        <input
          value={cfg.baseUrl}
          onChange={(e) => update("baseUrl", e.target.value)}
          placeholder={preset.baseUrl}
        />
      </div>
      <div className="field">
        <label>模型</label>
        <input value={cfg.model} onChange={(e) => update("model", e.target.value)} />
      </div>

      <div className="row">
        <div className="field">
          <label>母语</label>
          <input
            value={cfg.nativeLanguage}
            onChange={(e) => update("nativeLanguage", e.target.value)}
          />
        </div>
        <div className="field">
          <label>目标语言</label>
          <input
            value={cfg.targetLanguage}
            onChange={(e) => update("targetLanguage", e.target.value)}
          />
        </div>
        <div className="field">
          <label>水平</label>
          <input value={cfg.level} onChange={(e) => update("level", e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>API key {hasKey ? "(已保存 · 留空不改)" : "(未设置)"}</label>
        <div className="row">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey ? "••••••••" : keyPlaceholders[cfg.providerType]}
          />
          <button onClick={saveKey} disabled={!keyInput.trim()}>
            保存 key
          </button>
          {hasKey && (
            <button className="secondary" onClick={clearKey}>
              清除
            </button>
          )}
        </div>
      </div>

      <button className="secondary" onClick={testConnection} disabled={testing}>
        {testing ? "测试中…" : "测试连接(流式 + 非流式)"}
      </button>

      {status && <p className="status">{status}</p>}

      <hr className="settings-divider" />

      <h2>朗读 (MiMo TTS)</h2>
      <p className="settings-hint">
        聊天中 AI 回复、改正和更地道句子旁的小喇叭会调用 MiMo 语音合成。相同句子会缓存音频,避免重复请求。
        {ttsCacheCount !== null && ` 当前缓存 ${ttsCacheCount} 条。`}
      </p>

      <div className="field">
        <label>MiMo API key {hasTtsKey ? "(已保存 · 留空不改)" : "(未设置)"}</label>
        <div className="row">
          <input
            type="password"
            value={ttsKeyInput}
            onChange={(e) => setTtsKeyInput(e.target.value)}
            placeholder={hasTtsKey ? "••••••••" : "MiMo API key…"}
          />
          <button onClick={() => void saveTtsKey()} disabled={!ttsKeyInput.trim()}>
            保存 key
          </button>
          {hasTtsKey && (
            <button className="secondary" onClick={() => void clearTtsKey()}>
              清除
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <label>朗读风格 prompt (user 消息)</label>
        <textarea
          className="tts-prompt"
          value={ttsCfg.stylePrompt}
          onChange={(e) => updateTts("stylePrompt", e.target.value)}
          rows={3}
          placeholder="描述朗读的语气、语速、情感…"
        />
      </div>

      <div className="row">
        <div className="field">
          <label>音色</label>
          <select
            value={ttsCfg.voice}
            onChange={(e) => updateTts("voice", e.target.value)}
          >
            {MIMO_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>模型</label>
          <input
            value={ttsCfg.model}
            onChange={(e) => updateTts("model", e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Base URL</label>
        <input
          value={ttsCfg.baseUrl}
          onChange={(e) => updateTts("baseUrl", e.target.value)}
        />
      </div>

      <div className="row tts-actions">
        <button className="secondary" onClick={() => void testTts()} disabled={testingTts}>
          {testingTts ? "测试中…" : "测试朗读"}
        </button>
        <button
          className="secondary"
          onClick={() => void handleClearTtsCache()}
          disabled={clearingTtsCache || ttsCacheCount === 0}
        >
          {clearingTtsCache ? "清空中…" : "清空朗读缓存"}
        </button>
      </div>

      {ttsStatus && <p className="status">{ttsStatus}</p>}
    </div>
  );
}
