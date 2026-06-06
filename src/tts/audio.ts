// base64 → ArrayBuffer. The Rust-side synthesis commands (MiMo / Edge) return audio as base64; this converts it back on the frontend.
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
