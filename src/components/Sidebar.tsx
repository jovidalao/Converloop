import {
  BlocksIcon,
  BookOpenCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BRANCH_KIND_LABEL,
  type BranchKind,
  type ConversationMeta,
} from "../db/conversations";
import {
  deleteLearningAgent,
  type LearningAgentDraft,
  type LearningAgentMeta,
  updateLearningAgent,
} from "../db/learning-agents";
import { getActions, isAgentEnabled } from "../runtime";
import { useConfirm } from "./confirm";
import { LearningAgentEditDialog } from "./LearningAgentEditDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type MainView =
  | "chat"
  | "profile"
  | "mastery"
  | "learning"
  | "agents"
  | "settings";

// 相对时间:1 分钟内「刚刚」,然后分钟→小时→天→周→月→年逐级进位。
export function formatRelativeTime(ts: number): string {
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
  onDeriveConversation: (conversationId: string, actionId: string) => void;
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
  onDeriveConversation,
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
  const [learningCollapsed, setLearningCollapsed] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  // 设置菜单:点击外部关闭时不把焦点弹回触发按钮(否则按钮残留蓝色焦点环,需再点一次才消失)。
  // 键盘(Esc)关闭仍归还焦点,保留可达性。
  const settingsClosedByPointer = useRef(false);
  const [conversationMenu, setConversationMenu] = useState<{
    conv: ConversationMeta;
    x: number;
    y: number;
  } | null>(null);

  const derivationActions = getActions("session").filter((a) =>
    isAgentEnabled(a.id),
  );

  const editingAgent = useMemo(
    () => learningAgents.find((a) => a.id === editingAgentId) ?? null,
    [learningAgents, editingAgentId],
  );

  useEffect(() => {
    if (!conversationMenu) return;
    function close() {
      setConversationMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [conversationMenu]);

  // 右键:在鼠标处弹出衍生菜单(重命名/删除走行内按钮,不重复)。
  function openConversationMenu(e: ReactMouseEvent, c: ConversationMeta) {
    if (c.kind !== "practice" || derivationActions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setConversationMenu({
      conv: c,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 276)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
    });
  }

  // 「衍生」按钮:键盘/触控板可达的同一菜单,锚定到按钮下方。
  function openMenuFromButton(e: ReactMouseEvent, c: ConversationMeta) {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setConversationMenu({
      conv: c,
      x: Math.max(8, Math.min(r.right - 256, window.innerWidth - 276)),
      y: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 320)),
    });
  }

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
          <button
            type="button"
            className="codex-sidebar-action group"
            data-active={newChatActive}
            onClick={onNewChat}
            title="新对话 ⌘N"
            aria-keyshortcuts="Meta+N"
          >
            <span className="codex-sidebar-leading-icon">
              <SquarePenIcon className="size-4" />
            </span>
            <span>新对话</span>
            <kbd className="ml-auto rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground/80 opacity-0 transition-opacity group-hover:opacity-100">
              ⌘N
            </kbd>
          </button>
        </div>

        <nav className="codex-sidebar-scroll">
          <div className="codex-sidebar-learning">
            <button
              type="button"
              className="codex-section-heading"
              onClick={() => setLearningCollapsed((v) => !v)}
            >
              <span className="codex-sidebar-leading-icon">
                <GraduationCapIcon className="size-4 shrink-0" />
              </span>
              <span className="min-w-0 flex-1 truncate">定制化学习</span>
              {learningCollapsed ? (
                <ChevronRightIcon className="size-3.5 shrink-0" />
              ) : (
                <ChevronDownIcon className="size-3.5 shrink-0" />
              )}
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
                  <span className="codex-sidebar-leading-icon">
                    <BookOpenCheckIcon className="size-4 shrink-0" />
                  </span>
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
          </div>

          <div className="codex-section-label">最近</div>
          {conversations.map((c) => {
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
                onContextMenu={(e) => openConversationMenu(e, c)}
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
                {c.branchKind && (
                  <span
                    className="inline-flex shrink-0 text-[color:var(--codex-sidebar-muted)]"
                    title={`分支:${BRANCH_KIND_LABEL[c.branchKind as BranchKind] ?? c.branchKind}`}
                  >
                    <SparklesIcon className="size-3.5" />
                  </span>
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
                  {c.kind === "practice" && derivationActions.length > 0 && (
                    <button
                      type="button"
                      title="衍生新对话"
                      aria-label="衍生新对话"
                      onClick={(e) => openMenuFromButton(e, c)}
                    >
                      <SparklesIcon className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {conversations.length === 0 && (
            <div className="px-3 py-2 text-sm text-[color:var(--codex-sidebar-muted)]">
              还没有对话
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
                  view === "profile" ||
                  view === "agents"
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
              onPointerDownOutside={() => {
                settingsClosedByPointer.current = true;
              }}
              onCloseAutoFocus={(e) => {
                if (settingsClosedByPointer.current) {
                  e.preventDefault();
                  settingsClosedByPointer.current = false;
                }
              }}
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
              <DropdownMenuItem onSelect={() => onOpenView("agents")}>
                <BlocksIcon size={16} />
                能力库
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

      {conversationMenu && (
        <div
          className="fixed z-50 flex min-w-64 flex-col overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={{
            left: conversationMenu.x,
            top: conversationMenu.y,
            maxHeight: `${Math.min(420, Math.max(160, window.innerHeight - conversationMenu.y - 16))}px`,
          }}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
            <SparklesIcon size={13} />
            衍生新对话
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {derivationActions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onDeriveConversation(conversationMenu.conv.id, action.id);
                  setConversationMenu(null);
                }}
              >
                <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {action.label}
                  </span>
                  {action.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {action.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

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
