import { invoke } from "@tauri-apps/api/core";
import { db } from "../db/client";
import {
  agentJob,
  appState,
  conversation,
  learningAgent,
  learningProject,
  masteryEvent,
  masteryItem,
  memoryProposal,
  turn,
  turnAnnotation,
} from "../db/schema";
import { readProfileRaw, writeProfile } from "../profile/profile";

// One-file learning-data backup: every SQLite table + the Markdown profile +
// the mirrored user settings, as a single human-readable JSON bundle. Secrets
// (API keys, OAuth tokens) are device-bound encrypted and deliberately NOT
// exported. Import is a full replace — restore semantics, confirmed by the UI.

const BACKUP_VERSION = 1;
const LEGACY_BACKUP_KIND = "lang-agent.backup";
const BACKUP_KIND = "converloop.backup";

// Tables in the bundle, keyed by their SQL names. Insert order doesn't matter
// (no FK constraints); rows round-trip through Drizzle's camelCase shape.
const TABLES = {
  mastery_item: masteryItem,
  mastery_event: masteryEvent,
  conversation: conversation,
  turn: turn,
  learning_agent: learningAgent,
  turn_annotation: turnAnnotation,
  memory_proposal: memoryProposal,
  agent_job: agentJob,
  learning_project: learningProject,
  app_state: appState,
} as const;

type TableName = keyof typeof TABLES;

// Settings keys included in the bundle (same set the durability mirror tracks).
const SETTINGS_KEYS = [
  "lang-agent.config",
  "lang-agent.tts",
  "lang-agent.stt",
  "lang-agent.keybindings",
  "lang-agent-locale",
  "lang-agent-theme",
  "lang-agent-accent",
  "lang-agent-glass",
  "promptMacroOverrides",
  "customPromptMacros",
  "disabledAgents",
  "hiddenAgents",
  "builtinAgentOverrides",
] as const;

interface BackupBundle {
  kind: typeof BACKUP_KIND | typeof LEGACY_BACKUP_KIND;
  version: number;
  exportedAt: number;
  tables: Record<string, Record<string, unknown>[]>;
  profileMd: string | null;
  settings: Record<string, string>;
}

function withoutRetiredPronunciationData(
  name: string,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (name === "turn_annotation") {
    return rows.filter((row) => row.agentId !== "builtin:pronunciation");
  }
  if (name === "agent_job") {
    return rows.filter(
      (row) =>
        row.inputJson !== JSON.stringify({ agentId: "builtin:pronunciation" }),
    );
  }
  if (name === "mastery_item" || name === "mastery_event") {
    return rows.filter(
      (row) => typeof row.key !== "string" || !row.key.startsWith("shadowing:"),
    );
  }
  if (name === "learning_agent") {
    return rows.filter(
      (row) =>
        row.id !== "builtin:drill:shadowing" &&
        (typeof row.sourceMd !== "string" ||
          !row.sourceMd.includes("say-visible")),
    );
  }
  if (name === "conversation") {
    return rows.map((row) => {
      const modifiers = row.agentModifiersJson;
      if (
        typeof modifiers === "string" &&
        (modifiers.includes('"shadowing"') ||
          modifiers.includes('"say-visible"'))
      ) {
        return { ...row, agentModifiersJson: null };
      }
      return row;
    });
  }
  return rows;
}

export interface BackupSummary {
  conversations: number;
  turns: number;
  masteryItems: number;
  exportedAt: number;
}

export async function buildBackupBundle(): Promise<{
  json: string;
  summary: BackupSummary;
}> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    tables[name] = withoutRetiredPronunciationData(
      name,
      (await db.select().from(table)) as Record<string, unknown>[],
    );
  }
  const settings: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  }
  const bundle: BackupBundle = {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    tables,
    profileMd: await readProfileRaw(),
    settings,
  };
  return {
    json: JSON.stringify(bundle, null, 2),
    summary: {
      conversations: tables.conversation.length,
      turns: tables.turn.length,
      masteryItems: tables.mastery_item.length,
      exportedAt: bundle.exportedAt,
    },
  };
}

// Export to the Downloads folder via the Rust command (atomic write + reveal in
// the file manager). Returns the absolute path of the written file.
export async function exportBackupToDownloads(): Promise<{
  path: string;
  summary: BackupSummary;
}> {
  const { json, summary } = await buildBackupBundle();
  const stamp = new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")
    .replace(":", "");
  const path = await invoke<string>("export_backup", {
    content: json,
    fileName: `converloop-backup-${stamp}.json`,
  });
  return { path, summary };
}

export function parseBackupBundle(raw: string): {
  bundle: BackupBundle;
  summary: BackupSummary;
} {
  const parsed = JSON.parse(raw) as Partial<BackupBundle>;
  if (
    (parsed.kind !== BACKUP_KIND && parsed.kind !== LEGACY_BACKUP_KIND) ||
    typeof parsed.version !== "number"
  ) {
    throw new Error("Not a Converloop backup file");
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${parsed.version} is newer than this app understands (${BACKUP_VERSION})`,
    );
  }
  if (!parsed.tables || typeof parsed.tables !== "object") {
    throw new Error("Backup file has no table data");
  }
  const bundle = parsed as BackupBundle;
  return {
    bundle,
    summary: {
      conversations: bundle.tables.conversation?.length ?? 0,
      turns: bundle.tables.turn?.length ?? 0,
      masteryItems: bundle.tables.mastery_item?.length ?? 0,
      exportedAt: bundle.exportedAt ?? 0,
    },
  };
}

// Full-replace restore: wipe each table and insert the bundle's rows (chunked —
// SQLite caps bound parameters), overwrite the profile MD and the mirrored
// settings keys. Caller confirms first and reloads the app afterwards so every
// module re-reads the restored state.
export async function importBackupBundle(bundle: BackupBundle): Promise<void> {
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = bundle.tables[name as TableName];
    if (!Array.isArray(rows)) continue; // older bundle without this table — leave current data
    await db.delete(table);
    const sanitizedRows = withoutRetiredPronunciationData(name, rows);
    for (let i = 0; i < sanitizedRows.length; i += 50) {
      const chunk = sanitizedRows
        .slice(i, i + 50)
        .filter((r) => r && typeof r === "object");
      if (chunk.length > 0) {
        // Rows round-trip our own Drizzle shapes; the per-table generic isn't expressible across the union.
        await db.insert(table).values(chunk as never[]);
      }
    }
  }
  if (typeof bundle.profileMd === "string") {
    await writeProfile(bundle.profileMd);
  }
  if (bundle.settings && typeof bundle.settings === "object") {
    for (const key of SETTINGS_KEYS) {
      const value = bundle.settings[key];
      if (typeof value === "string") localStorage.setItem(key, value);
    }
  }
}
