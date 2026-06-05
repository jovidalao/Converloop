// Anthropic Claude Pro/Max 订阅登录(「Claude Code」式 OAuth,授权码 + PKCE)。
// 常量核对自 openclaw(src/llm/utils/oauth/anthropic.ts)。登录后拿到的 access 形如
// sk-ant-oat01-…,用法见 providers/anthropic.ts 的 oauth 分支(Bearer + beta + 身份 system 块)。
//
// token 交换/刷新复用 Rust 的 llm_request(通用 POST→文本,绕过 webview CORS)。

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { generatePkce, randomState } from "./pkce";
import { type OAuthTokens, tokensFromResponse } from "./store";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const CALLBACK_TIMEOUT_SECS = 300;

function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// POST JSON 到 token endpoint;llm_request 非 2xx 会抛 "HTTP <code>: <body>",含错误体便于排查。
async function postToken(body: Record<string, string>): Promise<OAuthTokens> {
  const text = await invoke<string>("llm_request", {
    url: TOKEN_URL,
    headers: { Accept: "application/json" },
    body,
  });
  return tokensFromResponse(text);
}

/**
 * 走完整授权码 + PKCE 登录:生成 PKCE → 先在 Rust 侧开始监听 127.0.0.1:53692 回调
 * → 打开浏览器授权 → 捕获 code/state → 交换 token。返回令牌交给调用方落库。
 */
export async function loginAnthropic(): Promise<OAuthTokens> {
  const { verifier, challenge } = await generatePkce();
  const state = randomState();

  // 先挂监听再开浏览器:避免极端情况下重定向早于监听就绪。invoke 立即开始绑定端口。
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
    state: result.state,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
}

/** 用 refresh token 换一组新令牌。 */
export function refreshAnthropic(refreshToken: string): Promise<OAuthTokens> {
  return postToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
}
