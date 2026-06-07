// User customization for "/" prompt macros (/topic, /learn, /surprise and user-defined ones).
// Built-in defaults live in commands.ts (BUILTIN_PROMPT_MACROS); this module persists only the user's
// overrides of the built-ins and any custom macros they add. Stored in localStorage (a frontend
// preference, consistent with enablement / builtin-overrides — not in SQLite), cached in memory.
// Empty override fields fall back to the built-in default; resolution + substitution lives in commands.ts.

const OVERRIDES_KEY = "promptMacroOverrides";
const CUSTOM_KEY = "customPromptMacros";

// Override of a built-in macro. Only the fields the user changed are stored; empty/missing = use the default.
export interface PromptMacroOverride {
  description?: string;
  argsHint?: string;
  template?: string;
}

// A user-defined macro. `id` is a stable key for editing (so renaming `name` while typing is safe);
// `name` is the command word (no slash). `{input}` in the template is replaced by the typed args.
export interface CustomPromptMacro {
  id: string;
  name: string;
  description?: string;
  argsHint?: string;
  template: string;
}

let overridesCache: Record<string, PromptMacroOverride> | null = null;
let customCache: CustomPromptMacro[] | null = null;

function loadOverrides(): Record<string, PromptMacroOverride> {
  if (overridesCache) return overridesCache;
  try {
    const raw = JSON.parse(
      localStorage.getItem(OVERRIDES_KEY) ?? "{}",
    ) as unknown;
    overridesCache =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, PromptMacroOverride>)
        : {};
  } catch {
    overridesCache = {};
  }
  return overridesCache;
}

function loadCustom(): CustomPromptMacro[] {
  if (customCache) return customCache;
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as unknown;
    customCache = Array.isArray(raw) ? (raw as CustomPromptMacro[]) : [];
  } catch {
    customCache = [];
  }
  return customCache;
}

function persistOverrides(map: Record<string, PromptMacroOverride>): void {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    // No localStorage in test environment: only the in-memory cache takes effect.
  }
}

function persistCustom(list: CustomPromptMacro[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    // No localStorage in test environment: only the in-memory cache takes effect.
  }
}

export function getPromptMacroOverrides(): Record<string, PromptMacroOverride> {
  return loadOverrides();
}

// Store only the fields that differ from the default (non-empty); if nothing remains, drop the override
// entirely so the built-in falls back to its default (and "reset" works).
export function setPromptMacroOverride(
  name: string,
  patch: PromptMacroOverride,
): void {
  const map = loadOverrides();
  const clean: PromptMacroOverride = {};
  if (patch.description?.trim()) clean.description = patch.description.trim();
  if (patch.argsHint?.trim()) clean.argsHint = patch.argsHint.trim();
  if (patch.template?.trim()) clean.template = patch.template;
  if (Object.keys(clean).length === 0) delete map[name];
  else map[name] = clean;
  persistOverrides(map);
}

export function clearPromptMacroOverride(name: string): void {
  const map = loadOverrides();
  delete map[name];
  persistOverrides(map);
}

export function getCustomPromptMacros(): CustomPromptMacro[] {
  return loadCustom();
}

// Upsert by id (create if new, replace if existing).
export function upsertCustomPromptMacro(macro: CustomPromptMacro): void {
  const list = loadCustom();
  const idx = list.findIndex((m) => m.id === macro.id);
  if (idx >= 0) list[idx] = macro;
  else list.push(macro);
  persistCustom(list);
}

export function deleteCustomPromptMacro(id: string): void {
  const list = loadCustom().filter((m) => m.id !== id);
  customCache = list;
  persistCustom(list);
}
