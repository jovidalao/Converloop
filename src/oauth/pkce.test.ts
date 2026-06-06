import { describe, expect, it } from "vitest";
import { generatePkce, randomState } from "./pkce";

const B64URL = /^[A-Za-z0-9_-]+$/; // base64url: no +, /, or =

async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("pkce", () => {
  it("challenge = base64url(sha256(verifier)), both url-safe", async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier).toMatch(B64URL);
    expect(challenge).toMatch(B64URL);
    expect(challenge).toBe(await sha256Base64url(verifier));
  });

  it("verifier and state are random per call", async () => {
    const a = await generatePkce();
    const b = await generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(randomState()).not.toBe(randomState());
  });
});
