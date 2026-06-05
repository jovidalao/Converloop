import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SearchIcon,
  SparklesIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { AgentLibraryView } from "./components/AgentLibraryView";
import { ChatView } from "./components/ChatView";
import { CoachPanel } from "./components/CoachPanel";
import { CommandPalette } from "./components/CommandPalette";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { LearningAgentsView } from "./components/LearningAgentsView";
import { MasteryView } from "./components/MasteryView";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import { type MainView, Sidebar } from "./components/Sidebar";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Spinner } from "./components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import {
  type ConversationMeta,
  clearActiveConversationId,
  createConversation,
  deleteConversation,
  ensureActiveConversation,
  listConversations,
  renameConversation,
  setActiveConversationId,
} from "./db/conversations";
import {
  ensureBuiltInLearningAgents,
  type LearningAgentMeta,
  listLearningAgents,
} from "./db/learning-agents";
import type { ChatTurn } from "./db/turns";
import { actionShortcutLabel, matchesActionShortcut } from "./lib/app-actions";
import { withViewTransition } from "./lib/view-transition";
import {
  beginAction,
  getActions,
  isAgentEnabled,
  reloadCustomRuntimeAgents,
} from "./runtime";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const COACH_MIN = 300;
const COACH_MAX = 560;

type AppLocation = {
  view: MainView;
  activeId: string;
};

function sameLocation(a: AppLocation, b: AppLocation): boolean {
  return a.view === b.view && a.activeId === b.activeId;
}

function App() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [learningAgents, setLearningAgents] = useState<LearningAgentMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<MainView>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [coachOpen, setCoachOpen] = useState(
    () => localStorage.getItem("coachOpen") !== "false",
  );
  const [coachTurn, setCoachTurn] = useState<ChatTurn | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [derivationBusy, setDerivationBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [resizingCoach, setResizingCoach] = useState(false);
  const [backStack, setBackStack] = useState<AppLocation[]>([]);
  const [forwardStack, setForwardStack] = useState<AppLocation[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 248;
  });
  const [coachWidth, setCoachWidth] = useState(() => {
    const saved = Number(localStorage.getItem("coachWidth"));
    return saved >= COACH_MIN && saved <= COACH_MAX ? saved : 360;
  });

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("coachWidth", String(coachWidth));
  }, [coachWidth]);

  useEffect(() => {
    localStorage.setItem("coachOpen", String(coachOpen));
  }, [coachOpen]);

  // 顶层轻量提示(如衍生失败):几秒后自动消失,也可手动关。
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 切换会话时清掉上一会话残留的本轮反馈,等新会话 ChatView 重新上报。
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId 仅作触发,effect 不读它
  useEffect(() => {
    setCoachTurn(null);
  }, [activeId]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const toggleCoach = useCallback(() => {
    setCoachOpen((c) => !c);
  }, []);

  const applyLocation = useCallback(
    (loc: AppLocation) => {
      if (
        loc.view === "chat" &&
        loc.activeId !== draftId &&
        conversations.some((c) => c.id === loc.activeId)
      ) {
        setActiveConversationId(loc.activeId);
      }
      withViewTransition(() => {
        setActiveId(loc.activeId);
        setView(loc.view);
      });
    },
    [conversations, draftId],
  );

  const navigateTo = useCallback(
    (loc: AppLocation) => {
      if (!activeId) {
        applyLocation(loc);
        return;
      }
      const current = { view, activeId };
      if (sameLocation(current, loc)) return;
      setBackStack((stack) => [...stack, current].slice(-50));
      setForwardStack([]);
      applyLocation(loc);
    },
    [activeId, applyLocation, view],
  );

  const goBack = useCallback(() => {
    if (!activeId) return;
    const current = { view, activeId };
    setBackStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setForwardStack((forward) => [...forward, current].slice(-50));
      applyLocation(next);
      return stack.slice(0, -1);
    });
  }, [activeId, applyLocation, view]);

  const goForward = useCallback(() => {
    if (!activeId) return;
    const current = { view, activeId };
    setForwardStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setBackStack((back) => [...back, current].slice(-50));
      applyLocation(next);
      return stack.slice(0, -1);
    });
  }, [activeId, applyLocation, view]);

  const openDraftConversation = useCallback(() => {
    const id = crypto.randomUUID();
    setDraftId(id);
    navigateTo({ view: "chat", activeId: id });
  }, [navigateTo]);

  const focusPanel = useCallback(
    (panel: "sidebar" | "chat" | "coach") => {
      if (panel === "sidebar") {
        setCollapsed(false);
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(".codex-sidebar")?.focus();
        });
        return;
      }
      if (panel === "chat") {
        if (activeId) navigateTo({ view: "chat", activeId });
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLTextAreaElement>(
            ".codex-main textarea",
          );
          input?.focus();
        });
        return;
      }
      setCoachOpen(true);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".codex-coach")?.focus();
      });
    },
    [activeId, navigateTo],
  );

  // ⌘, 设置 · ⌘B 侧栏 · ⌘N 新对话 · ⌘1/2/3 聚焦三栏 · ⌘/ 快捷键。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inField =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input, textarea, select, [contenteditable]");
      if (matchesActionShortcut(e, "settings")) {
        e.preventDefault();
        if (activeId) navigateTo({ view: "settings", activeId });
        return;
      }
      if (matchesActionShortcut(e, "command-palette")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (matchesActionShortcut(e, "new-chat")) {
        e.preventDefault();
        openDraftConversation();
        return;
      }
      if (matchesActionShortcut(e, "shortcuts")) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }
      if (matchesActionShortcut(e, "focus-sidebar")) {
        e.preventDefault();
        focusPanel("sidebar");
        return;
      }
      if (matchesActionShortcut(e, "focus-chat")) {
        e.preventDefault();
        focusPanel("chat");
        return;
      }
      if (matchesActionShortcut(e, "focus-coach")) {
        e.preventDefault();
        focusPanel("coach");
        return;
      }
      if (matchesActionShortcut(e, "toggle-sidebar") && !inField) {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, navigateTo, toggleSidebar, openDraftConversation, focusPanel]);

  const refresh = useCallback(
    () => listConversations().then(setConversations),
    [],
  );

  const refreshLearningAgents = useCallback(async () => {
    await reloadCustomRuntimeAgents();
    setLearningAgents(await listLearningAgents());
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draftId is only the initial blank chat id; later draft switches must not rerun startup selection.
  useEffect(() => {
    void (async () => {
      await ensureBuiltInLearningAgents();
      await refreshLearningAgents();
      const id = await ensureActiveConversation();
      setActiveId(id ?? draftId);
      await refresh();
      setReady(true);
    })();
  }, [refresh, refreshLearningAgents]);

  function selectConversation(id: string) {
    setActiveConversationId(id); // 持久化,不进过渡
    navigateTo({ view: "chat", activeId: id });
  }

  async function materializeDraftConversation(id: string) {
    await createConversation(undefined, id);
    setActiveConversationId(id);
    setDraftId((current) => (current === id ? crypto.randomUUID() : current));
  }

  async function startLearningAgent(agentId: string) {
    const agent = learningAgents.find((a) => a.id === agentId);
    const title = agent?.name ?? "定制化学习";
    const id = await createConversation(title, crypto.randomUUID(), {
      kind: "learning_agent",
      learningAgentId: agentId,
    });
    await refresh();
    selectConversation(id);
  }

  async function deriveConversation(
    conversationId: string,
    actionId: string,
    sourceTurnId?: string,
  ) {
    if (derivationBusy) return;
    setDerivationBusy(true);
    try {
      const result = await beginAction(actionId, {
        conversationId,
        sourceTurnId,
      });
      await refresh();
      if (result.navigateTo) selectConversation(result.navigateTo);
    } catch (e) {
      setToast(`对话衍生失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDerivationBusy(false);
    }
  }

  async function rename(id: string, title: string) {
    await renameConversation(id, title);
    await refresh();
  }

  async function remove(id: string) {
    await deleteConversation(id);
    const rest = await listConversations();
    setConversations(rest);
    if (id === activeId) {
      const nextId = rest[0]?.id;
      if (nextId) {
        selectConversation(nextId);
      } else {
        clearActiveConversationId();
        openDraftConversation();
      }
    }
  }

  function startTopbarDrag(e: MouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button,input,textarea,select,a,[data-no-window-drag]")
    )
      return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    void getCurrentWindow().startDragging();
  }

  function startCoachResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = coachWidth;
    let frame = 0;
    let nextWidth = startWidth;

    function flushResize() {
      frame = 0;
      setCoachWidth(Math.min(COACH_MAX, Math.max(COACH_MIN, nextWidth)));
    }

    function onMove(ev: PointerEvent) {
      nextWidth = startWidth - (ev.clientX - startX);
      if (!frame) frame = requestAnimationFrame(flushResize);
    }

    function finishResize() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        setCoachWidth(Math.min(COACH_MAX, Math.max(COACH_MIN, nextWidth)));
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizingCoach(false);
    }

    setResizingCoach(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  if (!ready || !activeId)
    return (
      <div className="flex h-full min-h-screen items-center justify-center text-ui-muted">
        加载中…
      </div>
    );

  const activeConversation = conversations.find((c) => c.id === activeId);
  const draftActive = view === "chat" && activeId === draftId;
  // 教练面板只在普通练习对话出现(专项课在对话内反馈,无结构化批改)。
  const coachEligible =
    view === "chat" && (activeConversation?.kind ?? "practice") === "practice";
  const coachVisible = coachEligible && coachOpen;
  const derivationActions = getActions("session").filter((a) =>
    isAgentEnabled(a.id),
  );
  const canDerive =
    view === "chat" &&
    !!activeConversation &&
    !draftActive &&
    activeConversation.kind === "practice" &&
    derivationActions.length > 0;
  const topbarTitle =
    view === "profile"
      ? "学习者档案"
      : view === "mastery"
        ? "学习数据"
        : view === "learning"
          ? "创建专项课"
          : view === "agents"
            ? "能力库"
            : view === "settings"
              ? "设置"
              : view === "chat"
                ? draftActive
                  ? "新对话"
                  : (activeConversation?.title ?? "")
                : "";

  return (
    <div
      className="codex-shell"
      data-sidebar-collapsed={collapsed}
      data-coach-open={coachVisible}
      data-sidebar-resizing={resizingSidebar}
      data-coach-resizing={resizingCoach}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--coach-width": `${coachWidth}px`,
        } as CSSProperties
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: custom Tauri chrome drag region */}
      <header
        className="codex-topbar"
        data-tauri-drag-region
        onMouseDown={startTopbarDrag}
      >
        <div className="codex-topbar-left">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="codex-chrome-button"
                  onClick={toggleSidebar}
                  aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                >
                  {collapsed ? <PanelRightIcon /> : <PanelLeftIcon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="flex items-center gap-2"
              >
                <span>{collapsed ? "展开侧栏" : "收起侧栏"}</span>
                <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                  {actionShortcutLabel("toggle-sidebar")}
                </kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="codex-chrome-button"
                  onClick={goBack}
                  disabled={backStack.length === 0}
                  aria-label="后退"
                >
                  <ChevronLeftIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <span>后退</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="codex-chrome-button"
                  onClick={goForward}
                  disabled={forwardStack.length === 0}
                  aria-label="前进"
                >
                  <ChevronRightIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <span>前进</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="codex-titlebar">
          <span className="truncate">{topbarTitle}</span>
        </div>
        <div className="codex-topbar-right">
          <TooltipProvider delayDuration={300}>
            {collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="codex-chrome-button"
                    onClick={openDraftConversation}
                    aria-label="新对话"
                  >
                    <SquarePenIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="end"
                  className="flex items-center gap-2"
                >
                  <span>新对话</span>
                  <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                    {actionShortcutLabel("new-chat")}
                  </kbd>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="codex-chrome-button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="搜索"
                >
                  <SearchIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="end"
                className="flex items-center gap-2"
              >
                <span>搜索</span>
                <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                  {actionShortcutLabel("command-palette")}
                </kbd>
              </TooltipContent>
            </Tooltip>
            {canDerive && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-ui-caption"
                    disabled={derivationBusy}
                    title="基于当前对话生成新的对话上下文"
                    data-no-window-drag
                  >
                    {derivationBusy ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <SparklesIcon size={15} />
                    )}
                    {derivationBusy ? "生成中…" : "衍生新对话"}
                    <ChevronDownIcon size={13} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] min-w-60 overflow-y-auto"
                >
                  {derivationActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      onSelect={() =>
                        void deriveConversation(activeId, action.id)
                      }
                    >
                      <SparklesIcon size={14} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {action.label}
                        </span>
                        {action.description && (
                          <span className="max-w-64 truncate text-ui-caption text-ui-muted">
                            {action.description}
                          </span>
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {coachEligible && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="codex-chrome-button"
                    onClick={toggleCoach}
                    data-active={coachVisible}
                    aria-pressed={coachVisible}
                    aria-label={coachVisible ? "隐藏教练面板" : "显示教练面板"}
                  >
                    <PanelRightIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end">
                  <span>{coachVisible ? "隐藏教练面板" : "显示教练面板"}</span>
                </TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </header>

      <div className="contents" data-focus-zone="sidebar">
        <Sidebar
          conversations={conversations}
          learningAgents={learningAgents}
          activeId={activeId}
          newChatActive={draftActive}
          view={view}
          onSelect={selectConversation}
          onNewChat={openDraftConversation}
          onStartLearningAgent={(id) => void startLearningAgent(id)}
          onRefreshLearningAgents={refreshLearningAgents}
          onDeriveConversation={(id, actionId) =>
            void deriveConversation(id, actionId)
          }
          onRename={(id, t) => void rename(id, t)}
          onDelete={(id) => void remove(id)}
          onOpenView={(v) => navigateTo({ view: v, activeId })}
          width={sidebarWidth}
          onResize={(w) =>
            setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
          }
          onResizeStart={() => setResizingSidebar(true)}
          onResizeEnd={() => setResizingSidebar(false)}
        />
      </div>

      <main className="codex-main relative flex min-h-0 flex-col overflow-hidden">
        <div
          className="flex min-h-0 flex-1 flex-col data-[hidden=true]:hidden"
          data-hidden={view !== "chat"}
        >
          <ChatView
            key={activeId}
            conversationId={activeId}
            isDraft={draftActive}
            mode={activeConversation?.kind ?? "practice"}
            onCreateDraftConversation={materializeDraftConversation}
            onActivity={() => void refresh()}
            onActiveTurnChange={setCoachTurn}
            onNavigateConversation={selectConversation}
            coachVisible={coachVisible}
          />
        </div>
        {view === "profile" && <ProfileView />}
        {view === "mastery" && <MasteryView />}
        {view === "learning" && (
          <LearningAgentsView onRefresh={refreshLearningAgents} />
        )}
        {view === "agents" && <AgentLibraryView />}
        {view === "settings" && <SettingsView />}
      </main>

      {coachVisible && (
        <aside className="codex-coach" tabIndex={-1}>
          <div
            className="codex-coach-resizer"
            onPointerDown={startCoachResize}
            title="拖动调整宽度"
          />
          <CoachPanel
            turn={coachTurn}
            onOpenView={(v) => navigateTo({ view: v, activeId })}
          />
        </aside>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        conversations={conversations}
        learningAgents={learningAgents}
        onSelectConversation={selectConversation}
        onStartLearningAgent={(id) => void startLearningAgent(id)}
        onNewChat={openDraftConversation}
      />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {toast && (
        <div className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 flex max-w-[min(90vw,30rem)] items-center gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3 text-ui-body text-foreground shadow-lg">
          <span className="min-w-0 flex-1">{toast}</span>
          <button
            type="button"
            className="shrink-0 text-ui-muted transition-colors hover:text-foreground"
            onClick={() => setToast(null)}
            aria-label="关闭"
          >
            <XIcon size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
