import { useMemo, useState } from "react";
import type { ConversationMeta } from "../db/conversations";
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
    <aside className="sidebar">
      <div className="sidebar-toolbar" data-tauri-drag-region>
        <button
          className="icon-btn"
          onClick={onToggleCollapse}
          title="收起侧栏"
          aria-label="收起侧栏"
        >
          <IconSidebar />
        </button>
        <button
          className="icon-btn"
          onClick={onNewChat}
          title="新对话"
          aria-label="新对话"
        >
          <IconCompose />
        </button>
      </div>

      <div className="sidebar-search">
        <IconSearch size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话"
          spellCheck={false}
        />
      </div>

      <nav className="conv-list">
        <div className="conv-section">最近</div>
        {filtered.map((c) => {
          const active = view === "chat" && c.id === activeId;
          if (editingId === c.id) {
            return (
              <input
                key={c.id}
                className="conv-rename"
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
              className={active ? "conv-row active" : "conv-row"}
              onClick={() => onSelect(c.id)}
              onDoubleClick={() => startEdit(c)}
            >
              <span className="conv-title">{c.title}</span>
              <span className="conv-actions">
                <button
                  className="conv-action"
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
                  className="conv-action"
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
          <div className="conv-empty">没有匹配的对话</div>
        )}
      </nav>

      <div className="sidebar-bottom">
        <button
          className={view === "profile" ? "nav-link active" : "nav-link"}
          onClick={() => onOpenView("profile")}
        >
          <IconProfile size={17} />
          档案
        </button>
        <button
          className={view === "settings" ? "nav-link active" : "nav-link"}
          onClick={() => onOpenView("settings")}
        >
          <IconSettings size={17} />
          设置
        </button>
      </div>
    </aside>
  );
}
