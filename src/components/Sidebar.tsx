import {
  BookOpenCheckIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  UserRoundIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { ConversationMeta } from "../db/conversations";
import type { LearningAgentMeta } from "../db/learning-agents";
import { Button } from "./ui/button";

export type MainView = "chat" | "profile" | "mastery" | "learning" | "settings";

interface SidebarProps {
  conversations: ConversationMeta[];
  learningAgents: LearningAgentMeta[];
  activeId: string;
  view: MainView;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onStartLearningAgent: (agentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenView: (view: MainView) => void;
  onToggleCollapse: () => void;
}

export function Sidebar({
  conversations,
  learningAgents,
  activeId,
  view,
  onSelect,
  onNewChat,
  onStartLearningAgent,
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
    <aside className="m-2 flex w-62 shrink-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* 左内边距须清开原生交通灯:traffic-inset + 灯组宽 52px + 间距。
          数值与 src-tauri/src/lib.rs 的 TRAFFIC_LIGHTS_X 对应,改一处要同步。 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-0.5 pr-2 pb-1 pl-[calc(0.15rem_+_(2rem_-_12px)/2_+_52px_+_0.35rem)]"
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onToggleCollapse}
          title="收起侧栏"
          aria-label="收起侧栏"
        >
          <PanelLeftIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onNewChat}
          title="新对话"
          aria-label="新对话"
        >
          <SquarePenIcon />
        </Button>
      </div>

      <div className="mx-2 mt-1 mb-2 flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground">
        <SearchIcon size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话"
          spellCheck={false}
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1.5">
        <div className="px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground">
          定制化学习
        </div>
        <div className="grid gap-1 pb-2">
          {learningAgents.slice(0, 5).map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={() => onStartLearningAgent(agent.id)}
              title={agent.description}
            >
              <GraduationCapIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground/90">
                  {agent.name}
                </span>
                <span className="block truncate text-xs leading-snug text-muted-foreground">
                  {agent.description}
                </span>
              </span>
            </button>
          ))}
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            onClick={() => onOpenView("learning")}
          >
            <PlusIcon className="size-4" />
            创建 / 编辑专项课
          </button>
        </div>
        <div className="px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground">
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
                // biome-ignore lint/a11y/noAutofocus: user-triggered inline rename — focus the field as it opens
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
            // biome-ignore lint/a11y/useSemanticElements: can't be a <button> — it nests the rename/delete action buttons; uses role+tabIndex+keyboard instead
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              className={`group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60"
              }`}
              onClick={() => onSelect(c.id)}
              onDoubleClick={() => startEdit(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
            >
              {c.kind === "learning_agent" && (
                <BookOpenCheckIcon className="size-3.5 shrink-0 text-primary" />
              )}
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.kind === "learning_agent" && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  专项
                </span>
              )}
              <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                <button
                  type="button"
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
                  type="button"
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

      <div className="flex flex-col gap-1 border-t p-1.5">
        <NavLink
          active={view === "mastery"}
          onClick={() => onOpenView("mastery")}
          icon={<ListChecksIcon size={17} />}
          label="数据"
          className="w-full"
        />
        <NavLink
          active={view === "profile"}
          onClick={() => onOpenView("profile")}
          icon={<UserRoundIcon size={17} />}
          label="档案"
          className="w-full"
        />
        <Button
          variant="ghost"
          size="sm"
          className={`w-full justify-start px-2 ${
            view === "settings"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          }`}
          onClick={() => onOpenView("settings")}
          title="设置"
          aria-label="设置"
        >
          <SettingsIcon size={17} />
          设置
        </Button>
      </div>
    </aside>
  );
}

function NavLink({
  active,
  onClick,
  icon,
  label,
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60"
      } ${className ?? ""}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
