import {
  BookOpenCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  UserRoundIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useState,
} from "react";
import type { ConversationMeta } from "../db/conversations";
import type { LearningAgentMeta } from "../db/learning-agents";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

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
  width: number;
  onResize: (width: number) => void;
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
  width,
  onResize,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [learningCollapsed, setLearningCollapsed] = useState(false);

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

  function startResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    function onMove(ev: PointerEvent) {
      onResize(startWidth + ev.clientX - startX);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <aside
      className="relative m-2 flex shrink-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
      style={{ width }}
    >
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

      <nav className="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto p-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-1 px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground"
          onClick={() => setLearningCollapsed((v) => !v)}
        >
          {learningCollapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
          定制化学习
        </button>
        <div className="grid gap-1 pb-2">
          {(learningCollapsed
            ? learningAgents.slice(0, 1)
            : learningAgents.slice(0, 5)
          ).map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={() => onStartLearningAgent(agent.id)}
              title={agent.description}
            >
              <GraduationCapIcon className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
                {agent.name}
              </span>
            </button>
          ))}
          {!learningCollapsed && (
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={() => onOpenView("learning")}
            >
              <PlusIcon className="size-4" />
              创建 / 编辑专项课
            </button>
          )}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`w-full justify-start px-2 ${
                view === "settings" || view === "mastery" || view === "profile"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              }`}
              title="设置"
              aria-label="设置"
            >
              <SettingsIcon size={17} />
              设置
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width)"
          >
            <DropdownMenuItem onSelect={() => onOpenView("settings")}>
              <SettingsIcon size={16} />
              设置
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenView("mastery")}>
              <ListChecksIcon size={16} />
              数据
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenView("profile")}>
              <UserRoundIcon size={16} />
              档案
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize hover:bg-primary/20"
        onPointerDown={startResize}
        title="拖动调整宽度"
      />
    </aside>
  );
}
