// PKCE(RFC 7636)+ state,跑在 webview 里用 Web Crypto。verifier 随机 32 字节 base64url,
// challenge = base64url(SHA-256(verifier))。OAuth 授权码流程(订阅登录)用它防止授权码被截获。

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBase64url(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function generatePkce(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = randomBase64url(32);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** 随机 state,用于回调时校验防 CSRF。 */
export function randomState(): string {
  return randomBase64url(32);
}
