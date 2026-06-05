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
  label: string;
  keys: string[];
  event?: {
    key: string;
    meta?: boolean;
    shift?: boolean;
  };
  ariaKeyshortcuts?: string;
}

export const APP_ACTIONS: AppAction[] = [
  {
    id: "new-chat",
    label: "新对话",
    keys: ["⌘", "N"],
    event: { key: "n", meta: true },
    ariaKeyshortcuts: "Meta+N",
  },
  {
    id: "command-palette",
    label: "搜索对话与专项课",
    keys: ["⌘", "K"],
    event: { key: "k", meta: true },
    ariaKeyshortcuts: "Meta+K",
  },
  {
    id: "toggle-sidebar",
    label: "显示 / 隐藏侧栏",
    keys: ["⌘", "B"],
    event: { key: "b", meta: true },
    ariaKeyshortcuts: "Meta+B",
  },
  {
    id: "settings",
    label: "打开设置",
    keys: ["⌘", ","],
    event: { key: ",", meta: true },
    ariaKeyshortcuts: "Meta+,",
  },
  {
    id: "focus-sidebar",
    label: "聚焦侧栏",
    keys: ["⌘", "1"],
    event: { key: "1", meta: true },
    ariaKeyshortcuts: "Meta+1",
  },
  {
    id: "focus-chat",
    label: "聚焦对话输入",
    keys: ["⌘", "2"],
    event: { key: "2", meta: true },
    ariaKeyshortcuts: "Meta+2",
  },
  {
    id: "focus-coach",
    label: "聚焦教练面板",
    keys: ["⌘", "3"],
    event: { key: "3", meta: true },
    ariaKeyshortcuts: "Meta+3",
  },
  {
    id: "shortcuts",
    label: "显示快捷键",
    keys: ["⌘", "/"],
    event: { key: "/", meta: true },
    ariaKeyshortcuts: "Meta+/",
  },
  { id: "slash-command", label: "输入命令", keys: ["/"] },
  { id: "dismiss", label: "关闭菜单或弹窗", keys: ["Esc"] },
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
