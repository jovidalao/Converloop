// 订阅登录(OAuth)令牌的本地存取。令牌 {access,refresh,expires} 序列化成 JSON,
// 走和 API key 同一条设备绑定加密通道(keychain → Rust secrets.rs),account key 由
// config.oauthAccount(type) 给出。这里不依赖 config(避免循环),按裸字符串 account 存取。

import { deleteSecret, getSecret, setSecret } from "../keychain";

export interface OAuthTokens {
  access: string;
  refresh: string;
  /** epoch ms,已减去刷新提前量(REFRESH_SKEW_MS);Date.now() >= expires 即应刷新。 */
  expires: number;
  /** OpenAI Codex 用:从 access JWT 解出的 ChatGPT account id。Anthropic 不需要。 */
  accountId?: string;
}

// 令牌真实到期前这么久就主动刷新,避免热路径上正好用到一个刚过期的 access。
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** token endpoint 的标准响应(access_token/refresh_token/expires_in)→ 内部 OAuthTokens。 */
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
      "OAuth token 响应缺少 access_token / refresh_token / expires_in 字段",
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
