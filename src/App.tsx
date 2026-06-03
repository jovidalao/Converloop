import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BrainIcon,
  ChevronDownIcon,
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
  useCallback,
  useEffect,
  useState,
} from "react";
import { AgentLibraryView } from "./components/AgentLibraryView";
import { ChatView } from "./components/ChatView";
import { CoachPanel } from "./components/CoachPanel";
import { CommandPalette } from "./components/CommandPalette";
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
import { withViewTransition } from "./lib/view-transition";
import {
  beginAction,
  getActions,
  isAgentEnabled,
  reloadCustomRuntimeAgents,
} from "./runtime";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;

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
  const [derivationBusy, setDerivationBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 248;
  });

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

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

  const openDraftConversation = useCallback(() => {
    const id = crypto.randomUUID();
    setDraftId(id);
    withViewTransition(() => {
      setActiveId(id);
      setView("chat");
    });
  }, []);

  // ⌘, 设置 · ⌘B 侧栏 · ⌘N 新对话(macOS 惯例)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inField =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input, textarea, select, [contenteditable]");
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        withViewTransition(() => setView("settings"));
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openDraftConversation();
        return;
      }
      if (e.metaKey && e.key.toLowerCase() === "b" && !inField) {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar, openDraftConversation]);

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
    withViewTransition(() => {
      setActiveId(id);
      setView("chat");
    });
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

  if (!ready || !activeId)
    return (
      <div className="flex h-full min-h-screen items-center justify-center text-muted-foreground">
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
              : "";

  return (
    <div
      className="codex-shell"
      data-sidebar-collapsed={collapsed}
      data-coach-open={coachVisible}
      data-sidebar-resizing={resizingSidebar}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
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
                <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground/80">
                  ⌘B
                </kbd>
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
                  <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground/80">
                    ⌘N
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
                <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground/80">
                  ⌘K
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
                    className="h-8 gap-1.5 px-2.5 text-xs"
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
                          <span className="max-w-64 truncate text-xs text-muted-foreground">
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
                    <BrainIcon />
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
        onOpenView={(v) => withViewTransition(() => setView(v))}
        width={sidebarWidth}
        onResize={(w) =>
          setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
        }
        onResizeStart={() => setResizingSidebar(true)}
        onResizeEnd={() => setResizingSidebar(false)}
      />

      <main className="vt-main codex-main relative flex min-h-0 flex-col overflow-hidden">
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
        <aside className="codex-coach">
          <CoachPanel
            turn={coachTurn}
            onOpenView={(v) => withViewTransition(() => setView(v))}
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

      {toast && (
        <div className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 flex max-w-[min(90vw,30rem)] items-center gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3 text-sm text-foreground shadow-lg">
          <span className="min-w-0 flex-1">{toast}</span>
          <button
            type="button"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
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
