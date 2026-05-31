import {
  BookOpenCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useState,
} from "react";
import type { ConversationMeta } from "../db/conversations";
import {
  deleteLearningAgent,
  type LearningAgentDraft,
  type LearningAgentMeta,
  updateLearningAgent,
} from "../db/learning-agents";
import { useConfirm } from "./confirm";
import { LearningAgentEditDialog } from "./LearningAgentEditDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type MainView = "chat" | "profile" | "mastery" | "learning" | "settings";

// 相对时间:1 分钟内「刚刚」,然后分钟→小时→天→周→月→年逐级进位。
function formatRelativeTime(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  const week = Math.floor(day / 7);
  if (day < 30) return `${week} 周前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(day / 365)} 年前`;
}

interface SidebarProps {
  conversations: ConversationMeta[];
  learningAgents: LearningAgentMeta[];
  activeId: string;
  newChatActive: boolean;
  view: MainView;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onStartLearningAgent: (agentId: string) => void;
  onRefreshLearningAgents: () => Promise<void>;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenView: (view: MainView) => void;
  width: number;
  onResize: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function Sidebar({
  conversations,
  learningAgents,
  activeId,
  newChatActive,
  view,
  onSelect,
  onNewChat,
  onStartLearningAgent,
  onRefreshLearningAgents,
  onRename,
  onDelete,
  onOpenView,
  width,
  onResize,
  onResizeStart,
  onResizeEnd,
}: SidebarProps) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [learningCollapsed, setLearningCollapsed] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  const editingAgent = useMemo(
    () => learningAgents.find((a) => a.id === editingAgentId) ?? null,
    [learningAgents, editingAgentId],
  );

  async function saveAgent(id: string, patch: Partial<LearningAgentDraft>) {
    await updateLearningAgent(id, patch);
    await onRefreshLearningAgents();
    setEditingAgentId(null);
  }

  async function removeAgent(agent: LearningAgentMeta) {
    if (agent.builtIn) return;
    if (
      !(await confirm({
        title: `删除专项课「${agent.name}」?`,
        description: "已有会话不会被删除。",
      }))
    )
      return;
    await deleteLearningAgent(agent.id);
    await onRefreshLearningAgents();
  }

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
    let frame = 0;
    let nextWidth = startWidth;

    function flushResize() {
      frame = 0;
      onResize(nextWidth);
    }

    function onMove(ev: PointerEvent) {
      nextWidth = startWidth + ev.clientX - startX;
      if (!frame) frame = requestAnimationFrame(flushResize);
    }

    function finishResize() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        onResize(nextWidth);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    }

    onResizeStart?.();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  return (
    <aside className="codex-sidebar">
      <div className="codex-sidebar-content">
        <div className="codex-sidebar-actions">
          <div className="codex-sidebar-search">
            <SearchIcon className="size-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="codex-sidebar-action"
            data-active={newChatActive}
            onClick={onNewChat}
          >
            <SquarePenIcon className="size-4" />
            <span>新对话</span>
          </button>
        </div>

        <nav className="codex-sidebar-scroll">
          <button
            type="button"
            className="codex-section-heading"
            onClick={() => setLearningCollapsed((v) => !v)}
          >
            {learningCollapsed ? (
              <ChevronRightIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
            <span>定制化学习</span>
          </button>
          <div className="codex-sidebar-list">
            {(learningCollapsed
              ? learningAgents.slice(0, 1)
              : learningAgents.slice(0, 5)
            ).map((agent) => (
              // biome-ignore lint/a11y/useSemanticElements: can't be a <button> — it nests the edit/delete action buttons; uses role+tabIndex+keyboard instead
              <div
                key={agent.id}
                role="button"
                tabIndex={0}
                className="codex-sidebar-row group"
                onClick={() => onStartLearningAgent(agent.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStartLearningAgent(agent.id);
                  }
                }}
                title={agent.description}
              >
                <GraduationCapIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                <span className="codex-row-actions">
                  <button
                    type="button"
                    title="编辑"
                    aria-label="编辑"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingAgentId(agent.id);
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  {!agent.builtIn && (
                    <button
                      type="button"
                      title="删除"
                      aria-label="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeAgent(agent);
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
            ))}
            {!learningCollapsed && (
              <button
                type="button"
                className="codex-sidebar-row"
                onClick={() => onOpenView("learning")}
              >
                <PlusIcon className="size-4" />
                <span>创建专项课</span>
              </button>
            )}
          </div>

          <div className="codex-section-label">最近</div>
          {filtered.map((c) => {
            const active = view === "chat" && c.id === activeId;
            if (editingId === c.id) {
              return (
                <input
                  key={c.id}
                  className="codex-sidebar-edit"
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
                className="codex-sidebar-row group"
                data-active={active}
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
                  <BookOpenCheckIcon className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="codex-row-meta group-hover:hidden">
                  {formatRelativeTime(c.updatedAt)}
                </span>
                <span className="codex-row-actions">
                  <button
                    type="button"
                    title="重命名"
                    aria-label="重命名"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(c);
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    aria-label="删除"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        await confirm({
                          title: `删除对话「${c.title}」?`,
                          description: "此操作不可撤销。",
                        })
                      ) {
                        onDelete(c.id);
                      }
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </span>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-[color:var(--codex-sidebar-muted)]">
              没有匹配的对话
            </div>
          )}
        </nav>

        <div className="codex-sidebar-footer">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="codex-sidebar-action"
                data-active={
                  view === "settings" ||
                  view === "mastery" ||
                  view === "profile"
                }
                title="设置"
                aria-label="设置"
              >
                <SettingsIcon size={17} />
                <span>设置</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="w-(--radix-dropdown-menu-trigger-width)"
            >
              <DropdownMenuItem onSelect={() => onOpenView("settings")}>
                <SettingsIcon size={16} />
                设置
                <kbd className="ml-auto rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground/80">
                  ⌘,
                </kbd>
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
      </div>

      <div
        className="codex-sidebar-resizer"
        onPointerDown={startResize}
        title="拖动调整宽度"
      />

      {editingAgent && (
        <LearningAgentEditDialog
          agent={editingAgent}
          onSave={(patch) => void saveAgent(editingAgent.id, patch)}
          onCancel={() => setEditingAgentId(null)}
        />
      )}
    </aside>
  );
}
