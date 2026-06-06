// Agent enable/disable (Phase 4). Which observers / actions the user has turned off are stored in
// localStorage (consistent with config and other frontend preferences, not in SQLite). Queried at
// runtime at the dispatch point; toggled via the agent library UI.
// Cached in memory to avoid repeatedly reading localStorage + JSON.parse on every hot-path turn.

const KEY = "disabledAgents";
let cache: Set<string> | null = null;

function disabled(): Set<string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export function isAgentEnabled(id: string): boolean {
  return !disabled().has(id);
}

export function setAgentEnabled(id: string, enabled: boolean): void {
  const set = disabled();
  if (enabled) set.delete(id);
  else set.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // No localStorage in test environment: only in-memory cache takes effect
  }
}
