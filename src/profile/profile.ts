import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../config";

// Rust 侧原子读写。
export const readProfileRaw = () => invoke<string | null>("read_profile");

export const writeProfile = (content: string) =>
  invoke<void>("write_profile", { content });

// AI 刷新前快照当前档案;restore 撤销到快照(返回恢复后的内容,无备份返回 null)。
export const snapshotProfile = () => invoke<void>("snapshot_profile");
export const restoreProfile = () => invoke<string | null>("restore_profile");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 见 docs/profile-maintainer-agent.md#learner-profilemd-模板
export function defaultProfile(config: AppConfig): string {
  return `# Learner Profile  ·  ${config.nativeLanguage} → ${config.targetLanguage} · ${config.level} · updated ${today()}

## About me
-

## AI preferences
### Global

### Conversation

### Correction

### Lessons

### Reading help

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

## Expression gaps
-

## My notes
<!-- 用户手写区,agent 永不改动 -->
`;
}

// 读 MD;不存在或被异常写空则返回默认模板(不落盘,等维护 agent 或用户首次写入)。
export async function readProfile(config: AppConfig): Promise<string> {
  const raw = await readProfileRaw();
  return raw?.trim() ? raw : defaultProfile(config);
}

// 对话 agent 的切片:整份档案,含 ## My notes —— 那是用户手写的记忆/指示,
// 对话要尊重(用户唯一能完全掌控、AI 逐字保留的一块)。只剥掉占位 HTML 注释,
// 避免把模板噪声塞进每轮 prompt。
export function profileSliceForConversation(md: string): string {
  return md
    .replace(/^##\s+AI preferences\s*$[\s\S]*?(?=^##\s+)/m, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
