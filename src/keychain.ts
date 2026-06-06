import { invoke } from "@tauri-apps/api/core";

// Keychain wrapper (Rust side src/secrets.rs: device-bound encrypted file). Secrets never go into localStorage.
export const getSecret = (account: string) =>
  invoke<string | null>("get_secret", { account });

export const setSecret = (account: string, secret: string) =>
  invoke<void>("set_secret", { account, secret });

export const deleteSecret = (account: string) =>
  invoke<void>("delete_secret", { account });
