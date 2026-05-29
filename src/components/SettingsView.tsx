import { useEffect, useState } from "react";
import {
  loadConfig,
  saveConfig,
  getProvider,
  API_KEY_ACCOUNT,
  type AppConfig,
} from "../config";
import { getSecret, setSecret, deleteSecret } from "../keychain";

export function SettingsView() {
  const [cfg, setCfg] = useState<AppConfig>(loadConfig());
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getSecret(API_KEY_ACCOUNT).then((k) => setHasKey(!!k));
  }, []);

  function update<K extends keyof AppConfig>(k: K, v: AppConfig[K]) {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    saveConfig(next);
  }

  async function saveKey() {
    if (!keyInput.trim()) return;
    await setSecret(API_KEY_ACCOUNT, keyInput.trim());
    setKeyInput("");
    setHasKey(true);
    setStatus("API key 已保存到 OS keychain。");
  }

  async function clearKey() {
    await deleteSecret(API_KEY_ACCOUNT);
    setHasKey(false);
    setStatus("API key 已从 keychain 清除。");
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
        <label>Base URL(OpenAI 兼容)</label>
        <input
          value={cfg.baseUrl}
          onChange={(e) => update("baseUrl", e.target.value)}
          placeholder="https://api.openai.com/v1"
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
            placeholder={hasKey ? "••••••••" : "sk-…"}
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
    </div>
  );
}
