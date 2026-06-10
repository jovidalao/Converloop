import { type MaintainerResult, runMaintainer } from "../agents/maintainer";
import { getProvider, loadConfig } from "../config";
import { getAppState, setAppState } from "../db/app-state";
import { getMaintainerData } from "../db/mastery";
import {
  formatHistorySince,
  getRecentlyIntroduced,
  getTurnCount,
} from "../db/turns";
import { staticT } from "../i18n";
import { readProfile } from "./profile";

// Single-flight: only one maintenance job may run at a time. If a new trigger arrives while one is running, skip it (it will be picked up next time).
let running = false;
let dirty = false;
let dirtyVersion = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const EVERY_N_TURNS = 10;
const IDLE_DELAY_MS = 10 * 60 * 1000;

// Transcript character budget (roughly ~1500 tokens; mixed CJK/Latin at ~4 chars/token with some headroom).
const TRANSCRIPT_CHAR_BUDGET = 6000;

// Timestamp of the last successful maintenance run (internal continuity marker, not user config). Only turns after this point are fed next time.
const WATERMARK_KEY = "lang-agent.lastMaintainedAt";

function parseTimestamp(raw: string | null): number {
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function getLastMaintainedAt(): Promise<number> {
  const dbValue = await getAppState(WATERMARK_KEY);
  if (dbValue !== null) return parseTimestamp(dbValue);
  return parseTimestamp(localStorage.getItem(WATERMARK_KEY));
}

async function setLastMaintainedAt(ts: number): Promise<void> {
  await setAppState(WATERMARK_KEY, String(ts));
  localStorage.removeItem(WATERMARK_KEY);
}

async function runJob(): Promise<MaintainerResult> {
  const provider = await getProvider();
  if (!provider)
    return { written: false, reason: staticT("errors.maintainerNoKey") };

  const config = loadConfig();
  // Capture the watermark before querying to avoid missing turns that arrive during the run (they are > watermark and will be fed next time).
  const watermark = Date.now();
  const currentMd = await readProfile(config);
  const data = await getMaintainerData();
  const recentlyIntroduced = await getRecentlyIntroduced();
  const transcript = await formatHistorySince(
    await getLastMaintainedAt(),
    TRANSCRIPT_CHAR_BUDGET,
  );

  const result = await runMaintainer(provider, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
    currentMd,
    data,
    recentlyIntroduced,
    transcript,
  });
  // Advance the watermark only after a successful write; on failure, keep the old watermark and retry with this batch of turns next time.
  if (result.written) await setLastMaintainedAt(watermark);
  return result;
}

// Manual trigger (profile page "Refresh profile"). Single-flight.
export async function runMaintainerNow(): Promise<MaintainerResult> {
  if (running)
    return { written: false, reason: staticT("errors.maintainerRunning") };
  running = true;
  const startedDirtyVersion = dirtyVersion;
  try {
    const result = await runJob();
    if (result.written && dirtyVersion === startedDirtyVersion) dirty = false;
    return result;
  } finally {
    running = false;
    if (dirty) scheduleMaintainerIdle();
  }
}

function clearIdleTimer(): void {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

export function scheduleMaintainerIdle(delayMs: number = IDLE_DELAY_MS): void {
  if (!dirty || running) return;
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!dirty || running) return;
    void runMaintainerNow().catch(() => {});
  }, delayMs);
}

export function flushMaintainerSoon(): void {
  if (!dirty || running) return;
  clearIdleTimer();
  void runMaintainerNow().catch(() => {});
}

// Trigger immediately once every N turns; otherwise schedule an idle refresh. Runs in the background; never blocks the hot path; never throws.
export async function maybeRunMaintainer(): Promise<void> {
  dirty = true;
  dirtyVersion++;
  if (running) return;
  const turns = await getTurnCount();
  if (turns > 0 && turns % EVERY_N_TURNS === 0) {
    clearIdleTimer();
    void runMaintainerNow().catch(() => {});
  } else {
    scheduleMaintainerIdle();
  }
}
