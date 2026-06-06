// User overrides for built-in agents (general, Phase 4+). Users can change the display name/description
// of built-in capabilities and APPEND supplementary instructions (does not replace the official base prompt).
// Overrides stored in localStorage (consistent with enablement, a frontend preference, not in SQLite);
// empty fields mean use the default. Merged at runtime in the agent library and at each capability call site;
// overrides do not touch counts / keys / provider settings.

const KEY = "builtinAgentOverrides";

export interface BuiltinAgentOverride {
  label?: string;
  description?: string;
  /** Supplementary instructions appended after the official base prompt (does not replace the base prompt). */
  instructions?: string;
}

let cache: Record<string, BuiltinAgentOverride> | null = null;

function all(): Record<string, BuiltinAgentOverride> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    cache =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, BuiltinAgentOverride>)
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(map: Record<string, BuiltinAgentOverride>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // No localStorage in test environment: only in-memory cache takes effect
  }
}

export function getBuiltinAgentOverride(
  id: string,
): BuiltinAgentOverride | undefined {
  return all()[id];
}

export function setBuiltinAgentOverride(
  id: string,
  patch: BuiltinAgentOverride,
): void {
  const map = all();
  const clean: BuiltinAgentOverride = {};
  if (patch.label?.trim()) clean.label = patch.label.trim();
  if (patch.description?.trim()) clean.description = patch.description.trim();
  if (patch.instructions?.trim())
    clean.instructions = patch.instructions.trim();
  if (Object.keys(clean).length === 0) delete map[id];
  else map[id] = clean;
  persist(map);
}

export function clearBuiltinAgentOverride(id: string): void {
  const map = all();
  delete map[id];
  persist(map);
}
