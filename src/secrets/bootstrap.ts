import { apiKeyAccount, type ProviderType } from "../config";
import { getSecret, setSecret } from "../keychain";

const PROVIDER_TYPES: ProviderType[] = ["openai", "gemini", "anthropic"];

function defaultLlmApiKey(): string | undefined {
  const key = import.meta.env.VITE_DEFAULT_LLM_API_KEY?.trim();
  return key || undefined;
}

/** On first launch, write the default LLM key from .env into encrypted storage (MiMo TTS must be configured separately; existing keys are not overwritten). */
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
