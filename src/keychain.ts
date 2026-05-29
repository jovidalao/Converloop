import { invoke } from "@tauri-apps/api/core";

// OS keychain 包装(Rust 侧 keyring)。secret 绝不进 localStorage。
export const getSecret = (account: string) =>
  invoke<string | null>("get_secret", { account });

export const setSecret = (account: string, secret: string) =>
  invoke<void>("set_secret", { account, secret });

export const deleteSecret = (account: string) =>
  invoke<void>("delete_secret", { account });
