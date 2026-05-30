import { getSecret, setSecret } from "../keychain";
import { apiKeyAccount, type ProviderType } from "../config";

const PROVIDER_TYPES: ProviderType[] = ["openai", "gemini", "anthropic"];

function defaultLlmApiKey(): string | undefined {
  const key = import.meta.env.VITE_DEFAULT_LLM_API_KEY?.trim();
  return key || undefined;
}

/** 首次启动时把 .env 里的默认 LLM key 写入 keychain(MiMo TTS 需单独配置,已有 key 的不覆盖)。 */
export async function ensureDefaultApiKeys(): Promise<void> {
  const apiKey = defaultLlmApiKey();
  if (!apiKey) return;

  await Promise.all(
    PROVIDER_TYPES.map(async (type) => {
      const account = apiKeyAccount(type);
      const existing = await getSecret(account);
      if (!existing) await setSecret(account, apiKey);
    }),
  );
}
