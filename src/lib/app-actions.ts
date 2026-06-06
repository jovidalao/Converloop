export type AppActionId =
  | "new-chat"
  | "command-palette"
  | "toggle-sidebar"
  | "settings"
  | "focus-sidebar"
  | "focus-chat"
  | "focus-coach"
  | "shortcuts"
  | "slash-command"
  | "dismiss";

export interface AppAction {
  id: AppActionId;
  keys: string[];
  event?: {
    key: string;
    meta?: boolean;
    shift?: boolean;
  };
  ariaKeyshortcuts?: string;
}

// Human-readable labels live in i18n under the `actions` namespace, keyed by id.
export const APP_ACTIONS: AppAction[] = [
  {
    id: "new-chat",
    keys: ["⌘", "N"],
    event: { key: "n", meta: true },
    ariaKeyshortcuts: "Meta+N",
  },
  {
    id: "command-palette",
    keys: ["⌘", "K"],
    event: { key: "k", meta: true },
    ariaKeyshortcuts: "Meta+K",
  },
  {
    id: "toggle-sidebar",
    keys: ["⌘", "B"],
    event: { key: "b", meta: true },
    ariaKeyshortcuts: "Meta+B",
  },
  {
    id: "settings",
    keys: ["⌘", ","],
    event: { key: ",", meta: true },
    ariaKeyshortcuts: "Meta+,",
  },
  {
    id: "focus-sidebar",
    keys: ["⌘", "1"],
    event: { key: "1", meta: true },
    ariaKeyshortcuts: "Meta+1",
  },
  {
    id: "focus-chat",
    keys: ["⌘", "2"],
    event: { key: "2", meta: true },
    ariaKeyshortcuts: "Meta+2",
  },
  {
    id: "focus-coach",
    keys: ["⌘", "3"],
    event: { key: "3", meta: true },
    ariaKeyshortcuts: "Meta+3",
  },
  {
    id: "shortcuts",
    keys: ["⌘", "/"],
    event: { key: "/", meta: true },
    ariaKeyshortcuts: "Meta+/",
  },
  { id: "slash-command", keys: ["/"] },
  { id: "dismiss", keys: ["Esc"] },
];

export function getAppAction(id: AppActionId): AppAction {
  const action = APP_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`Unknown app action: ${id}`);
  return action;
}

export function actionShortcutLabel(id: AppActionId): string {
  return getAppAction(id).keys.join("");
}

export function matchesActionShortcut(
  event: KeyboardEvent,
  id: AppActionId,
): boolean {
  const shortcut = getAppAction(id).event;
  if (!shortcut) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return (
    key === shortcut.key &&
    event.metaKey === !!shortcut.meta &&
    event.shiftKey === !!shortcut.shift &&
    !event.altKey &&
    !event.ctrlKey
  );
}
