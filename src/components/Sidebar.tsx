import { useMemo, useState, type ReactNode } from "react";
import type { ConversationMeta } from "../db/conversations";
import { Button } from "./ui/button";
import {
  IconSidebar,
  IconCompose,
  IconSearch,
  IconProfile,
  IconSettings,
} from "./icons";

export type MainView = "chat" | "profile" | "settings";

interface SidebarProps {
  conversations: ConversationMeta[];
  activeId: string;
  view: MainView;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenView: (view: MainView) => void;
  onToggleCollapse: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  view,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onOpenView,
  onToggleCollapse,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  function startEdit(c: ConversationMeta) {
    setEditingId(c.id);
    setDraft(c.title);
  }

  function commitEdit() {
    if (editingId) {
      const t = draft.trim();
      if (t) onRename(editingId, t);
    }
    setEditingId(null);
  }

  return (
    <aside className="m-[0.55rem] flex w-[248px] shrink-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* 左内边距须清开原生交通灯:traffic-inset + 灯组宽 52px + 间距。
          数值与 src-tauri/src/lib.rs 的 TRAFFIC_LIGHTS_X 对应,改一处要同步。 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-0.5 pt-[0.15rem] pr-2 pb-[0.3rem] pl-[calc(0.15rem_+_(2rem_-_12px)/2_+_52px_+_0.35rem)]"
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onToggleCollapse}
          title="收起侧栏"
          aria-label="收起侧栏"
        >
          <IconSidebar />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onNewChat}
          title="新对话"
          aria-label="新对话"
        >
          <IconCompose />
        </Button>
      </div>

      <div className="mx-[0.55rem] mt-1 mb-2 flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground">
        <IconSearch size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话"
          spellCheck={false}
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1.5">
        <div className="px-2 pt-1.5 pb-1 text-[0.7rem] font-semibold tracking-wide text-muted-foreground">
          最近
        </div>
        {filtered.map((c) => {
          const active = view === "chat" && c.id === activeId;
          if (editingId === c.id) {
            return (
              <input
                key={c.id}
                className="mx-0.5 my-px rounded-md border border-input bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            );
          }
          return (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60"
              }`}
              onClick={() => onSelect(c.id)}
              onDoubleClick={() => startEdit(c)}
            >
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                <button
                  className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                  title="重命名"
                  aria-label="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(c);
                  }}
                >
                  ✎
                </button>
                <button
                  className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                  title="删除"
                  aria-label="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`删除对话「${c.title}」?此操作不可撤销。`)) {
                      onDelete(c.id);
                    }
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-2 py-2 text-sm text-muted-foreground">
            没有匹配的对话
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-px border-t p-1.5">
        <NavLink
          active={view === "profile"}
          onClick={() => onOpenView("profile")}
          icon={<IconProfile size={17} />}
          label="档案"
        />
        <NavLink
          active={view === "settings"}
          onClick={() => onOpenView("settings")}
          icon={<IconSettings size={17} />}
          label="设置"
        />
      </div>
    </aside>
  );
}

function NavLink({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
