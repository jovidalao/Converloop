// base64 → ArrayBuffer。Rust 侧合成命令(MiMo / Edge)都把音频按 base64 回传,前端在此还原。
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
