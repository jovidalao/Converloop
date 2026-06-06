// Local storage for subscription login (OAuth) tokens. Tokens {access,refresh,expires} are serialized to JSON
// and stored through the same device-bound encrypted channel as API keys (keychain → Rust secrets.rs); the account key is
// provided by config.oauthAccount(type). This module does not depend on config (to avoid circular imports) — it accesses by raw account string.

import { deleteSecret, getSecret, setSecret } from "../keychain";

export interface OAuthTokens {
  access: string;
  refresh: string;
  /** Epoch ms with the refresh skew (REFRESH_SKEW_MS) already subtracted; when Date.now() >= expires, refresh. */
  expires: number;
  /** Used by OpenAI Codex: the ChatGPT account id extracted from the access JWT. Not needed by Anthropic. */
  accountId?: string;
}

// Proactively refresh this far before the real token expiry, to avoid hitting a just-expired access token on the hot path.
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Standard token endpoint response (access_token/refresh_token/expires_in) → internal OAuthTokens. */
export function tokensFromResponse(
  responseText: string,
  extra?: Partial<OAuthTokens>,
): OAuthTokens {
  const data = JSON.parse(responseText) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (
    !data.access_token ||
    !data.refresh_token ||
    typeof data.expires_in !== "number"
  ) {
    throw new Error(
      "OAuth token response missing access_token / refresh_token / expires_in fields",
    );
  }
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000 - REFRESH_SKEW_MS,
    ...extra,
  };
}

export async function getTokens(account: string): Promise<OAuthTokens | null> {
  const raw = await getSecret(account);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return null;
  }
}

export async function setTokens(
  account: string,
  tokens: OAuthTokens,
): Promise<void> {
  await setSecret(account, JSON.stringify(tokens));
}

export async function clearTokens(account: string): Promise<void> {
  await deleteSecret(account);
}
