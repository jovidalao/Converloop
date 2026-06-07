// Anthropic Claude Pro/Max subscription login ("Claude Code"-style OAuth, authorization code + PKCE).
// Constants verified against openclaw (src/llm/utils/oauth/anthropic.ts). The access token obtained after login looks like
// sk-ant-oat01-…; see the oauth branch in providers/anthropic.ts for usage (Bearer + beta header + identity system block).
//
// Token exchange/refresh reuses the Rust llm_request command (generic POST→text, bypasses webview CORS).

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

// POST JSON to the token endpoint; llm_request throws "HTTP <code>: <body>" on non-2xx, including the error body for debugging.
async function postToken(body: Record<string, string>): Promise<OAuthTokens> {
  const text = await invoke<string>("llm_request", {
    url: TOKEN_URL,
    headers: { Accept: "application/json" },
    body,
  });
  return tokensFromResponse(text);
}

/**
 * Full authorization code + PKCE login flow: generate PKCE → start listening on the Rust side for a 127.0.0.1:53692 callback
 * → open browser for authorization → capture code/state → exchange for tokens. Returns the tokens for the caller to persist.
 */
export async function loginAnthropic(): Promise<OAuthTokens> {
  const { verifier, challenge } = await generatePkce();
  const state = randomState();

  // Register the listener before opening the browser: avoids the edge case where the redirect arrives before the listener is ready. invoke begins binding the port immediately.
  const callback = invoke<{ code: string; state: string }>("oauth_listen", {
    port: CALLBACK_PORT,
    path: CALLBACK_PATH,
    timeoutSecs: CALLBACK_TIMEOUT_SECS,
  });
  await openUrl(buildAuthorizeUrl(challenge, state));
  const result = await callback;

  if (result.state !== state) {
    throw new Error(
      "OAuth state mismatch; possible security risk — please log in again.",
    );
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

/** Exchange a refresh token for a new set of tokens. */
export function refreshAnthropic(refreshToken: string): Promise<OAuthTokens> {
  return postToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
}
