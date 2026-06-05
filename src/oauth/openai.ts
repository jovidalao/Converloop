// OpenAI Codex(「Sign in with ChatGPT」)订阅登录:授权码 + PKCE。常量核对自 openclaw
// (extensions/openai/openai-chatgpt-oauth-flow.runtime.ts)。登录后的 access 是 JWT,
// 用法见 providers/openai-responses.ts(Responses API @ chatgpt.com/backend-api/codex)。
//
// 注意:OpenAI token endpoint 要 application/x-www-form-urlencoded,所以走 Rust 的
// oauth_token_post(表单编码),不能复用发 JSON 的 llm_request。

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { generatePkce, randomState } from "./pkce";
import { type OAuthTokens, tokensFromResponse } from "./store";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
// 与官方 Codex CLI 对齐,便于 chatgpt 后端把请求识别为 Codex 客户端。
const ORIGINATOR = "codex_cli_rs";
const CALLBACK_TIMEOUT_SECS = 300;

// base64url JWT 解码:取 access 中段 payload,读 ChatGPT account id(调用 Responses 时要带 header)。
function decodeAccountId(accessToken: string): string | undefined {
  const segment = accessToken.split(".")[1];
  if (!segment) return undefined;
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const payload = JSON.parse(atob(b64 + pad)) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const id = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    codex_cli_simplified_flow: "true",
    originator: ORIGINATOR,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// 表单编码 POST 到 token endpoint;附带从新 access 解出的 accountId。
async function postToken(form: Record<string, string>): Promise<OAuthTokens> {
  const text = await invoke<string>("oauth_token_post", {
    url: TOKEN_URL,
    form,
  });
  const tokens = tokensFromResponse(text);
  return { ...tokens, accountId: decodeAccountId(tokens.access) };
}

/** 走完整授权码 + PKCE 登录(回调端口 1455),返回令牌交给调用方落库。 */
export async function loginOpenAICodex(): Promise<OAuthTokens> {
  const { verifier, challenge } = await generatePkce();
  const state = randomState();

  const callback = invoke<{ code: string; state: string }>("oauth_listen", {
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
    timeoutSecs: CALLBACK_TIMEOUT_SECS,
  });
  await openUrl(buildAuthorizeUrl(challenge, state));
  const result = await callback;

  if (result.state !== state) {
    throw new Error("OAuth state 不匹配,可能存在风险,请重新登录。");
  }
  return postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: result.code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });
}

/** 用 refresh token 换一组新令牌(并重新解出 accountId)。 */
export function refreshOpenAICodex(refreshToken: string): Promise<OAuthTokens> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
}
