import { getAppState, setAppState } from "../db/app-state";

// Durability mirror for user-asset settings that live in WebView localStorage.
//
// localStorage stays the synchronous live store (config/theme/i18n read it at
// startup), but it is wiped whenever the OS or user clears WebView data and it
// does not travel with SQLite backups. So a snapshot of the user-asset keys is
// mirrored into app_state: restored at boot when localStorage lost them, and
// included in the backup bundle (see lib/backup.ts) like any other app_state row.
//
// Only keys the user would mind losing are mirrored. Pure UI traces (panel
// widths, collapsed flags, seen-banner lists) are deliberately not on the list.
const MIRRORED_KEYS = [
  "lang-agent.config", // provider connections, languages, level
  "lang-agent.tts", // TTS engine/voice settings
  "lang-agent.stt", // voice-input endpoint/model
  "lang-agent.keybindings",
  "lang-agent-locale",
  "lang-agent-theme",
  "lang-agent-accent",
  "lang-agent-glass",
  "promptMacroOverrides", // customized slash prompt macros
  "customPromptMacros",
  "disabledAgents", // capability enablement
  "hiddenAgents",
  "builtinAgentOverrides", // user-tuned built-in agent instructions
  "lang-agent.activeConversation",
] as const;

const MIRROR_STATE_KEY = "lang-agent.settingsMirror";
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

// null = key intentionally absent at snapshot time. Restoring distinguishes
// "never set / cleared" (null, leave alone) from "had a value" (restore it).
type MirrorBundle = Record<string, string | null>;

function collectBundle(): MirrorBundle {
  const bundle: MirrorBundle = {};
  for (const key of MIRRORED_KEYS) {
    bundle[key] = localStorage.getItem(key);
  }
  return bundle;
}

let lastSnapshotJson: string | null = null;

export async function snapshotSettingsToMirror(): Promise<void> {
  const json = JSON.stringify(collectBundle());
  if (json === lastSnapshotJson) return; // nothing changed since the last write
  await setAppState(MIRROR_STATE_KEY, json);
  lastSnapshotJson = json;
}

// Put mirrored values back into localStorage for keys that are missing locally
// (i.e. the WebView store was wiped or this is a restored backup). Existing
// local values always win — the mirror never overwrites live state.
export async function restoreSettingsFromMirror(): Promise<string[]> {
  const raw = await getAppState(MIRROR_STATE_KEY);
  if (!raw) return [];
  let bundle: MirrorBundle;
  try {
    bundle = JSON.parse(raw) as MirrorBundle;
  } catch {
    return [];
  }
  const restored: string[] = [];
  for (const key of MIRRORED_KEYS) {
    const value = bundle[key];
    if (typeof value === "string" && localStorage.getItem(key) === null) {
      localStorage.setItem(key, value);
      restored.push(key);
    }
  }
  return restored;
}

// Boot hook: restore lost settings before the app reads them, then keep the
// mirror fresh — once now, on hide/close, and on a slow heartbeat. Must be
// awaited before the first render so config/theme/i18n see restored values.
export async function startSettingsMirror(): Promise<void> {
  try {
    await restoreSettingsFromMirror();
  } catch {
    // DB unavailable (e.g. plain-browser dev) — run without the mirror.
    return;
  }
  const snapshot = () => void snapshotSettingsToMirror().catch(() => {});
  snapshot();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) snapshot();
  });
  window.addEventListener("beforeunload", snapshot);
  window.setInterval(snapshot, SNAPSHOT_INTERVAL_MS);
}
