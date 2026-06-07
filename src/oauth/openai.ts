// OpenAI Codex ("Sign in with ChatGPT") subscription login: authorization code + PKCE. Constants verified against openclaw
// (extensions/openai/openai-chatgpt-oauth-flow.runtime.ts). The access token obtained after login is a JWT;
// see providers/openai-responses.ts for usage (Responses API @ chatgpt.com/backend-api/codex).
//
// Note: the OpenAI token endpoint requires application/x-www-form-urlencoded, so we use the Rust
// oauth_token_post command (form-encoded) instead of the JSON-sending llm_request.

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
// Aligned with the official Codex CLI so the ChatGPT backend recognizes the request as a Codex client.
const ORIGINATOR = "codex_cli_rs";
const CALLBACK_TIMEOUT_SECS = 300;

// Decode a base64url JWT: extract the middle-segment payload from the access token to read the ChatGPT account id (required as a header when calling Responses).
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

// Form-encoded POST to the token endpoint; attaches the accountId extracted from the new access token.
async function postToken(form: Record<string, string>): Promise<OAuthTokens> {
  const text = await invoke<string>("oauth_token_post", {
    url: TOKEN_URL,
    form,
  });
  const tokens = tokensFromResponse(text);
  return { ...tokens, accountId: decodeAccountId(tokens.access) };
}

/** Full authorization code + PKCE login flow (callback port 1455); returns tokens for the caller to persist. */
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
    throw new Error(
      "OAuth state mismatch; possible security risk — please log in again.",
    );
  }
  return postToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: result.code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
  });
}

/** Exchange a refresh token for a new set of tokens (and re-extract accountId). */
export function refreshOpenAICodex(refreshToken: string): Promise<OAuthTokens> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
}
