// PKCE (RFC 7636) + state, running in the webview using Web Crypto. verifier is 32 random bytes as base64url;
// challenge = base64url(SHA-256(verifier)). Used in the OAuth authorization code flow (subscription login) to prevent authorization code interception.

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

/** Random state value used to validate the callback and prevent CSRF. */
export function randomState(): string {
  return randomBase64url(32);
}
