import {
  ArrowLeftIcon,
  BlocksIcon,
  BookOpenCheckIcon,
  BotIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  ScrollTextIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
  UserRoundIcon,
  Volume2Icon,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { actionShortcutLabel, getAppAction } from "@/lib/app-actions";
import type { ConversationMeta } from "../db/conversations";
import {
  deleteLearningAgent,
  type LearningAgentDraft,
  type LearningAgentMeta,
  updateLearningAgent,
} from "../db/learning-agents";
import { getActions, isAgentEnabled } from "../runtime";
import { useConfirm } from "./confirm";
import { EntityRow, EntityRowAction, EntitySection } from "./EntityRow";
import { LearningAgentEditDialog } from "./LearningAgentEditDialog";

export type MainView =
  | "chat"
  | "profile"
  | "mastery"
  | "learning"
  | "agents"
  | "settings-logs"
  | "settings-general"
  | "settings-llm"
  | "settings-tts";

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
  /** Sidebar is drilled into the settings sub-menu (derived from the active view). */
  settingsMode: boolean;
  /** Leave the settings sub-menu and return to the conversation list / chat. */
  onExitSettings: () => void;
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
  settingsMode,
  onExitSettings,
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
  const [conversationMenu, setConversationMenu] = useState<{
    conv: ConversationMeta;
    x: number;
    y: number;
  } | null>(null);

  const derivationActions = getActions("session").filter((a) =>
    isAgentEnabled(a.id),
  );
  const newChatAction = getAppAction("new-chat");

  // Learning lessons (capped at 5) all live in the animated body, so collapsing
  // the section hides every one — nothing peeks while collapsed.
  const visibleLearningAgents = learningAgents.slice(0, 5);

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

  const renderAgentRow = (agent: LearningAgentMeta) => (
    <EntityRow
      key={agent.id}
      className="codex-sidebar-child-row"
      icon={<BookOpenCheckIcon className="size-3.5 shrink-0" />}
      title={agent.name}
      tooltip={agent.description}
      onSelect={() => onStartLearningAgent(agent.id)}
      actions={
        <>
          <EntityRowAction
            label="编辑"
            icon={<PencilIcon className="size-3.5" />}
            onClick={(e) => {
              e.stopPropagation();
              setEditingAgentId(agent.id);
            }}
          />
          {!agent.builtIn && (
            <EntityRowAction
              label="删除"
              icon={<Trash2Icon className="size-3.5" />}
              onClick={(e) => {
                e.stopPropagation();
                void removeAgent(agent);
              }}
            />
          )}
        </>
      }
    />
  );

  // 设置子菜单的行:与「新对话」「设置」入口同款 .codex-sidebar-action,选中态走 data-active。
  const renderSettingsItem = (v: MainView, icon: ReactNode, label: string) => (
    <button
      key={v}
      type="button"
      className="codex-sidebar-action"
      data-active={view === v}
      onClick={() => onOpenView(v)}
    >
      <span className="codex-sidebar-leading-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="codex-sidebar" tabIndex={-1}>
      <div className="codex-sidebar-content">
        <div
          className="codex-sidebar-track"
          data-mode={settingsMode ? "settings" : "main"}
        >
          {/* Pane 1:会话 inbox。drilled into settings 时滑出并 inert。 */}
          <div className="codex-sidebar-pane" inert={settingsMode || undefined}>
            <div className="codex-sidebar-actions">
              <button
                type="button"
                className="codex-sidebar-action group"
                data-active={newChatActive}
                onClick={onNewChat}
                title={`${newChatAction.label} ${actionShortcutLabel("new-chat")}`}
                aria-keyshortcuts={newChatAction.ariaKeyshortcuts}
              >
                <span className="codex-sidebar-leading-icon">
                  <SquarePenIcon className="size-4" />
                </span>
                <span>新对话</span>
                <kbd className="ml-auto rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted opacity-0 transition-opacity group-hover:opacity-100">
                  {actionShortcutLabel("new-chat")}
                </kbd>
              </button>
            </div>

            <nav className="codex-sidebar-scroll">
              <EntitySection
                icon={<GraduationCapIcon className="size-4 shrink-0" />}
                label="定制化学习"
                collapsed={learningCollapsed}
                onToggle={() => setLearningCollapsed((v) => !v)}
              >
                {visibleLearningAgents.map(renderAgentRow)}
                <EntityRow
                  className="codex-sidebar-child-row"
                  icon={<PlusIcon className="size-3.5 shrink-0" />}
                  title="创建专项课"
                  onSelect={() => onOpenView("learning")}
                />
              </EntitySection>

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
                  <EntityRow
                    key={c.id}
                    active={active}
                    icon={
                      c.kind === "learning_agent" ? (
                        <BookOpenCheckIcon className="size-3.5 shrink-0" />
                      ) : undefined
                    }
                    title={c.title}
                    meta={formatRelativeTime(c.updatedAt)}
                    onSelect={() => onSelect(c.id)}
                    onContextMenu={(e) => openConversationMenu(e, c)}
                    onDoubleClick={() => startEdit(c)}
                    actions={
                      <>
                        <EntityRowAction
                          label="重命名"
                          icon={<PencilIcon className="size-3.5" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(c);
                          }}
                        />
                        <EntityRowAction
                          label="删除"
                          icon={<Trash2Icon className="size-3.5" />}
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
                        />
                        {c.kind === "practice" &&
                          derivationActions.length > 0 && (
                            <EntityRowAction
                              label="衍生新对话"
                              icon={<SparklesIcon className="size-3.5" />}
                              onClick={(e) => openMenuFromButton(e, c)}
                            />
                          )}
                      </>
                    }
                  />
                );
              })}
              {conversations.length === 0 && (
                <div className="px-3 py-2 text-ui-body text-[color:var(--codex-sidebar-muted)]">
                  还没有对话
                </div>
              )}
            </nav>

            <div className="codex-sidebar-footer">
              <button
                type="button"
                className="codex-sidebar-action group"
                onClick={() => onOpenView("settings-general")}
                title={`设置 ${actionShortcutLabel("settings")}`}
                aria-label="设置"
              >
                <span className="codex-sidebar-leading-icon">
                  <SettingsIcon size={17} />
                </span>
                <span>设置</span>
                <ChevronRightIcon className="ml-auto size-4 text-ui-muted transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* Pane 2:设置子菜单。drilled out 时滑出并 inert。 */}
          <div
            className="codex-sidebar-pane"
            inert={!settingsMode || undefined}
          >
            <nav className="codex-sidebar-scroll">
              <div className="codex-section-label">设置内容</div>
              {renderSettingsItem(
                "settings-general",
                <SlidersHorizontalIcon className="size-4" />,
                "通用设置",
              )}
              {renderSettingsItem(
                "settings-llm",
                <BotIcon className="size-4" />,
                "LLM 提供商",
              )}
              {renderSettingsItem(
                "settings-tts",
                <Volume2Icon className="size-4" />,
                "TTS 提供商",
              )}

              <div className="codex-section-label">档案数据库</div>
              {renderSettingsItem(
                "mastery",
                <ListChecksIcon className="size-4" />,
                "数据",
              )}
              {renderSettingsItem(
                "agents",
                <BlocksIcon className="size-4" />,
                "能力库",
              )}
              {renderSettingsItem(
                "settings-logs",
                <ScrollTextIcon className="size-4" />,
                "日志",
              )}
              {renderSettingsItem(
                "profile",
                <UserRoundIcon className="size-4" />,
                "档案",
              )}
            </nav>

            <div className="codex-sidebar-footer">
              <button
                type="button"
                className="codex-sidebar-action group"
                onClick={onExitSettings}
                aria-label="返回"
              >
                <span className="codex-sidebar-leading-icon">
                  <ArrowLeftIcon className="size-4 text-ui-muted transition-transform group-hover:-translate-x-0.5" />
                </span>
                <span>返回</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="codex-sidebar-resizer"
        onPointerDown={startResize}
        title="拖动调整宽度"
      />

      {conversationMenu && (
        <div
          className="fixed z-50 flex min-w-64 flex-col overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-minimal"
          style={{
            left: conversationMenu.x,
            top: conversationMenu.y,
            maxHeight: `${Math.min(420, Math.max(160, window.innerHeight - conversationMenu.y - 16))}px`,
          }}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 text-ui-caption font-medium text-ui-muted">
            <SparklesIcon size={13} />
            衍生新对话
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {derivationActions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left text-ui-body outline-none hover:bg-accent hover:text-accent-foreground"
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
                    <span className="block truncate text-ui-caption text-ui-muted">
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
