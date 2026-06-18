import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../config";

// Atomic read/write on the Rust side.
export const readProfileRaw = () => invoke<string | null>("read_profile");

export const writeProfile = (content: string) =>
  invoke<void>("write_profile", { content });

// Snapshot the current profile before an AI refresh; restore reverts to the snapshot (returns the restored content, or null if there is no backup).
export const snapshotProfile = () => invoke<void>("snapshot_profile");
export const restoreProfile = () => invoke<string | null>("restore_profile");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

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
<!-- User-written section — agents must never modify this -->
`;
}

// Read the profile MD; if it does not exist or was accidentally emptied, return the default template (not written to disk — waits for the maintainer agent or the user's first write).
export async function readProfile(config: AppConfig): Promise<string> {
  const raw = await readProfileRaw();
  return raw?.trim() ? raw : defaultProfile(config);
}

// Profile slice for the conversation agent: the full profile including ## My notes — that is user-authored memory/instructions
// that the conversation must respect (the one section the user has full control over and the AI preserves verbatim). Only placeholder HTML comments are stripped
// to avoid injecting template noise into every turn's prompt.
export function profileSliceForConversation(md: string): string {
  return md
    .replace(/^##\s+AI preferences\s*$[\s\S]*?(?=^##\s+)/m, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
