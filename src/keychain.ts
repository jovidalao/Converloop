import { invoke } from "@tauri-apps/api/core";

// 密钥存储包装(Rust 侧 src/secrets.rs:设备绑定加密文件)。secret 绝不进 localStorage。
export const getSecret = (account: string) =>
  invoke<string | null>("get_secret", { account });

export const setSecret = (account: string, secret: string) =>
  invoke<void>("set_secret", { account, secret });

export const deleteSecret = (account: string) =>
  invoke<void>("delete_secret", { account });
