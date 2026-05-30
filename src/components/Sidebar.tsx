import { useState } from "react";
import type { ConversationMeta } from "../db/conversations";

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
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
      <div className="sidebar-top">
        <span className="brand">lang-agent</span>
        <button className="new-chat" onClick={onNewChat} title="新对话">
          ＋ 新对话
        </button>
      </div>

      <nav className="conv-list">
        {conversations.map((c) => {
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
      </nav>

      <div className="sidebar-bottom">
        <button
          className={view === "profile" ? "nav-link active" : "nav-link"}
          onClick={() => onOpenView("profile")}
        >
          档案
        </button>
        <button
          className={view === "settings" ? "nav-link active" : "nav-link"}
          onClick={() => onOpenView("settings")}
        >
          设置
        </button>
      </div>
    </aside>
  );
}
