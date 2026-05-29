import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../config";

// Rust 侧原子读写。
export const readProfileRaw = () =>
  invoke<string | null>("read_profile");

export const writeProfile = (content: string) =>
  invoke<void>("write_profile", { content });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 见 docs/profile-maintainer-agent.md#learner-profilemd-模板
export function defaultProfile(config: AppConfig): string {
  return `# Learner Profile  ·  ${config.nativeLanguage} → ${config.targetLanguage} · ${config.level} · updated ${today()}

## Working on
-

## Comfortable with
-

## Avoids / rarely attempts
-

## Interests
-

## Recently introduced
-

## My notes
<!-- 用户手写区,agent 永不改动 -->
`;
}

// 读 MD;不存在则返回默认模板(不落盘,等维护 agent 或用户首次写入)。
export async function readProfile(config: AppConfig): Promise<string> {
  const raw = await readProfileRaw();
  return raw ?? defaultProfile(config);
}

// 对话 agent 的切片:去掉 ## My notes(它只读定性人设,不需要用户私人笔记)。
export function profileSliceForConversation(md: string): string {
  const idx = md.indexOf("## My notes");
  return (idx === -1 ? md : md.slice(0, idx)).trim();
}
