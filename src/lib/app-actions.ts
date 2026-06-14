import { useSyncExternalStore } from "react";
import { z } from "zod";

export type AppActionId =
  | "new-chat"
  | "command-palette"
  | "navigate-back"
  | "navigate-forward"
  | "toggle-sidebar"
  | "settings"
  | "focus-sidebar"
  | "focus-chat"
  | "focus-coach"
  | "shortcuts"
  | "voice-input"
  | "refresh-hints"
  | "slash-command"
  | "send"
  | "new-line"
  | "stop-generating"
  | "dismiss";

// A key chord: the main key plus required modifier state. `key` is a single
// lowercased character (e.g. "n", "/") or a named key (e.g. "Escape").
export interface KeyBinding {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface AppAction {
  id: AppActionId;
  /** Default chord for rebindable actions. Absent for fixed contextual hints. */
  defaultBinding?: KeyBinding;
  /** Display caps for fixed actions that have no rebindable chord. */
  fixedKeys?: string[];
}

// Human-readable labels live in i18n under the `actions` namespace, keyed by id.
export const APP_ACTIONS: AppAction[] = [
  { id: "new-chat", defaultBinding: { key: "n", meta: true } },
  { id: "command-palette", defaultBinding: { key: "k", meta: true } },
  { id: "navigate-back", defaultBinding: { key: "[", meta: true } },
  { id: "navigate-forward", defaultBinding: { key: "]", meta: true } },
  { id: "toggle-sidebar", defaultBinding: { key: "b", meta: true } },
  { id: "settings", defaultBinding: { key: ",", meta: true } },
  { id: "focus-sidebar", defaultBinding: { key: "1", meta: true } },
  { id: "focus-chat", defaultBinding: { key: "2", meta: true } },
  { id: "focus-coach", defaultBinding: { key: "3", meta: true } },
  { id: "shortcuts", defaultBinding: { key: "/", meta: true } },
  { id: "voice-input", defaultBinding: { key: "v", meta: true, shift: true } },
  {
    id: "refresh-hints",
    defaultBinding: { key: "h", meta: true, shift: true },
  },
  { id: "slash-command", fixedKeys: ["/"] },
  { id: "send", fixedKeys: ["↩"] },
  { id: "new-line", fixedKeys: ["⇧", "↩"] },
  { id: "stop-generating", fixedKeys: ["Esc"] },
  { id: "dismiss", fixedKeys: ["Esc"] },
];

// Actions whose chord can be customized (everything with a default chord).
export const EDITABLE_ACTIONS = APP_ACTIONS.filter(
  (a): a is AppAction & { defaultBinding: KeyBinding } => !!a.defaultBinding,
);

export function getAppAction(id: AppActionId): AppAction {
  const action = APP_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`Unknown app action: ${id}`);
  return action;
}

// --- Custom chord overrides -------------------------------------------------
// Defaults above are static; users can remap any editable action. Overrides are
// stored (per action id) in localStorage and read reactively, mirroring config.ts.

const KeyBindingSchema = z.object({
  key: z.string().min(1),
  meta: z.boolean().optional(),
  ctrl: z.boolean().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
});

export type KeybindingOverrides = Partial<Record<AppActionId, KeyBinding>>;

const STORAGE_KEY = "lang-agent.keybindings";
const EDITABLE_IDS = new Set<AppActionId>(EDITABLE_ACTIONS.map((a) => a.id));

let cached: KeybindingOverrides | null = null;
const listeners = new Set<() => void>();

function readOverrides(): KeybindingOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: KeybindingOverrides = {};
    for (const id of EDITABLE_IDS) {
      const parsed = KeyBindingSchema.safeParse(obj[id]);
      if (parsed.success) out[id] = parsed.data;
    }
    return out;
  } catch {
    return {};
  }
}

function getOverrides(): KeybindingOverrides {
  if (!cached) cached = readOverrides();
  return cached;
}

function persist(next: KeybindingOverrides): void {
  cached = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

export function setKeybinding(id: AppActionId, binding: KeyBinding): void {
  persist({ ...getOverrides(), [id]: binding });
}

export function resetKeybinding(id: AppActionId): void {
  const next = { ...getOverrides() };
  delete next[id];
  persist(next);
}

export function resetAllKeybindings(): void {
  persist({});
}

export function hasKeybindingOverride(id: AppActionId): boolean {
  return id in getOverrides();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Reactive read of the override map; components re-render when a chord changes.
export function useKeybindings(): KeybindingOverrides {
  return useSyncExternalStore(subscribe, getOverrides);
}

// The chord currently in effect for an action (custom override, else default).
export function effectiveBinding(id: AppActionId): KeyBinding | undefined {
  return getOverrides()[id] ?? getAppAction(id).defaultBinding;
}

// --- Display & matching -----------------------------------------------------

const MOD_SYMBOLS: { flag: keyof KeyBinding; symbol: string }[] = [
  { flag: "ctrl", symbol: "⌃" },
  { flag: "alt", symbol: "⌥" },
  { flag: "shift", symbol: "⇧" },
  { flag: "meta", symbol: "⌘" },
];

const NAMED_KEY_CAPS: Record<string, string> = {
  Escape: "Esc",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↩",
};

function keyCap(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return NAMED_KEY_CAPS[key] ?? key;
}

// Mac-ordered key caps for a chord: ⌃ ⌥ ⇧ ⌘ then the key.
export function bindingKeyCaps(binding: KeyBinding): string[] {
  const caps = MOD_SYMBOLS.filter(({ flag }) => binding[flag]).map(
    (m) => m.symbol,
  );
  caps.push(keyCap(binding.key));
  return caps;
}

// Caps to display for any action (custom chord or fixed hint).
export function actionKeyCaps(id: AppActionId): string[] {
  const binding = effectiveBinding(id);
  if (binding) return bindingKeyCaps(binding);
  return getAppAction(id).fixedKeys ?? [];
}

export function actionShortcutLabel(id: AppActionId): string {
  return actionKeyCaps(id).join("");
}

// "Meta+Shift+N" form for the aria-keyshortcuts attribute.
export function actionAriaKeyshortcuts(id: AppActionId): string | undefined {
  const b = effectiveBinding(id);
  if (!b) return undefined;
  const parts: string[] = [];
  if (b.ctrl) parts.push("Control");
  if (b.alt) parts.push("Alt");
  if (b.shift) parts.push("Shift");
  if (b.meta) parts.push("Meta");
  parts.push(b.key.length === 1 ? b.key.toUpperCase() : b.key);
  return parts.join("+");
}

interface EventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// Whether a keyboard event exactly matches a chord (all four modifiers compared).
export function bindingMatchesEvent(
  binding: KeyBinding,
  e: EventLike,
): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return (
    key === binding.key &&
    e.metaKey === !!binding.meta &&
    e.ctrlKey === !!binding.ctrl &&
    e.shiftKey === !!binding.shift &&
    e.altKey === !!binding.alt
  );
}

export function matchesActionShortcut(
  event: KeyboardEvent,
  id: AppActionId,
): boolean {
  const binding = effectiveBinding(id);
  return binding ? bindingMatchesEvent(binding, event) : false;
}

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.key === b.key &&
    !!a.meta === !!b.meta &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

// The id of another editable action already bound to this chord, or null.
export function findBindingConflict(
  binding: KeyBinding,
  excludeId: AppActionId,
): AppActionId | null {
  for (const action of EDITABLE_ACTIONS) {
    if (action.id === excludeId) continue;
    const current = effectiveBinding(action.id);
    if (current && bindingsEqual(current, binding)) return action.id;
  }
  return null;
}

// Require a non-shift modifier so a chord never fires while the user is typing.
export function bindingHasModifier(binding: KeyBinding): boolean {
  return !!(binding.meta || binding.ctrl || binding.alt);
}
