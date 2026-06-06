// Built-in capability "delete" = permanently hidden (no recovery). Which agents the user has hidden
// is stored in localStorage (same frontend preference as enablement, not in SQLite). Filtered at
// runtime in the agent library / action menu / on-demand transformers; "hidden" has different semantics
// from "disabled" — disabled can be re-enabled, hidden has no recovery entry point.
// Custom agent "delete" goes through a real DB delete, not here.

const KEY = "hiddenAgents";
let cache: Set<string> | null = null;

function hidden(): Set<string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export function isAgentHidden(id: string): boolean {
  return hidden().has(id);
}

export function hideAgent(id: string): void {
  const set = hidden();
  set.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // No localStorage in test environment: only in-memory cache takes effect
  }
}
