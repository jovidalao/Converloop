import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GraduationCapIcon,
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
import { AppDesignView } from "./components/AppDesignView";
import { ChatView } from "./components/ChatView";
import { CoachPanel } from "./components/CoachPanel";
import { CommandPalette } from "./components/CommandPalette";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { LearningAgentsView } from "./components/LearningAgentsView";
import { LogsView } from "./components/LogsView";
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
import { useTranslation } from "./i18n";
import { actionShortcutLabel, matchesActionShortcut } from "./lib/app-actions";
import { withViewTransition } from "./lib/view-transition";
import { flushMaintainerSoon } from "./profile/maintainer-runner";
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

// Views inside the settings sub-menu (the three settings pages + three profile
// database pages). Entering these drills the sidebar into the settings panel;
// "Create lesson" lives under the main sidebar's custom-learning group and is
// not treated as a settings view.
const SETTINGS_VIEWS: ReadonlySet<MainView> = new Set<MainView>([
  "settings-general",
  "settings-llm",
  "settings-tts",
  "design",
  "mastery",
  "agents",
  "settings-logs",
  "profile",
]);

function isSettingsView(view: MainView): boolean {
  return SETTINGS_VIEWS.has(view);
}

function App() {
  const { t } = useTranslation();
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
  const [coachTurns, setCoachTurns] = useState<ChatTurn[]>([]);
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

  // Top-level lightweight toast (e.g. a derivation failure): auto-dismisses
  // after a few seconds, and can also be closed manually.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // When switching conversations, clear the previous conversation's leftover
  // per-turn feedback; the new conversation's ChatView re-reports it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId is only a trigger; the effect doesn't read it
  useEffect(() => {
    setCoachTurns([]);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    flushMaintainerSoon();
  }, [activeId]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) flushMaintainerSoon();
    }
    function onBeforeUnload() {
      flushMaintainerSoon();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const toggleCoach = useCallback(() => {
    setCoachOpen((c) => !c);
  }, []);

  const applyLocation = useCallback(
    (loc: AppLocation) => {
      if (isSettingsView(loc.view)) {
        setCollapsed(false);
      }
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

  // ⌘, settings · ⌘B sidebar · ⌘N new chat · ⌘1/2/3 focus the three panes · ⌘/ shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inField =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input, textarea, select, [contenteditable]");
      if (matchesActionShortcut(e, "settings")) {
        e.preventDefault();
        if (activeId) navigateTo({ view: "settings-general", activeId });
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
    setActiveConversationId(id); // persist; no view transition
    navigateTo({ view: "chat", activeId: id });
  }

  async function materializeDraftConversation(id: string) {
    await createConversation(undefined, id);
    setActiveConversationId(id);
    setDraftId((current) => (current === id ? crypto.randomUUID() : current));
  }

  async function startLearningAgent(agentId: string) {
    const agent = learningAgents.find((a) => a.id === agentId);
    const title = agent?.name ?? t("app.customLearningFallback");
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
      setToast(
        t("app.deriveFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
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
        {t("common.loading")}
      </div>
    );

  const activeConversation = conversations.find((c) => c.id === activeId);
  const draftActive = view === "chat" && activeId === draftId;
  // The coach panel only appears in regular practice conversations (lessons
  // give feedback inline, without structured correction).
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
  const settingsMode = isSettingsView(view);
  const TOPBAR_TITLES: Partial<Record<MainView, string>> = {
    profile: t("viewTitles.profile"),
    mastery: t("viewTitles.mastery"),
    learning: t("viewTitles.learning"),
    design: t("viewTitles.design"),
    agents: t("viewTitles.agents"),
    "settings-logs": t("viewTitles.logs"),
    "settings-general": t("viewTitles.general"),
    "settings-llm": t("viewTitles.llm"),
    "settings-tts": t("viewTitles.tts"),
  };
  const topbarTitle =
    view === "chat"
      ? draftActive
        ? t("app.newChat")
        : (activeConversation?.title ?? "")
      : (TOPBAR_TITLES[view] ?? "");

  const secondaryView =
    view === "profile" ? (
      <ProfileView />
    ) : view === "mastery" ? (
      <MasteryView />
    ) : view === "learning" ? (
      <LearningAgentsView onRefresh={refreshLearningAgents} />
    ) : view === "design" ? (
      <AppDesignView />
    ) : view === "agents" ? (
      <AgentLibraryView onOpenView={(v) => navigateTo({ view: v, activeId })} />
    ) : view === "settings-logs" ? (
      <LogsView />
    ) : view === "settings-general" ? (
      <SettingsView section="general" />
    ) : view === "settings-llm" ? (
      <SettingsView section="llm" />
    ) : view === "settings-tts" ? (
      <SettingsView section="tts" />
    ) : null;

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
                  aria-label={
                    collapsed
                      ? t("app.expandSidebar")
                      : t("app.collapseSidebar")
                  }
                >
                  {collapsed ? <PanelRightIcon /> : <PanelLeftIcon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="start"
                className="flex items-center gap-2"
              >
                <span>
                  {collapsed
                    ? t("app.expandSidebar")
                    : t("app.collapseSidebar")}
                </span>
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
                  aria-label={t("app.back")}
                >
                  <ChevronLeftIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <span>{t("app.back")}</span>
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
                  aria-label={t("app.forward")}
                >
                  <ChevronRightIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <span>{t("app.forward")}</span>
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
                    aria-label={t("app.newChat")}
                  >
                    <SquarePenIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="end"
                  className="flex items-center gap-2"
                >
                  <span>{t("app.newChat")}</span>
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
                  aria-label={t("app.search")}
                >
                  <SearchIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="end"
                className="flex items-center gap-2"
              >
                <span>{t("app.search")}</span>
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
                    title={t("app.deriveTooltip")}
                    data-no-window-drag
                  >
                    {derivationBusy ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <SparklesIcon size={15} />
                    )}
                    {derivationBusy
                      ? t("app.deriving")
                      : t("app.deriveNewConversation")}
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
                    aria-label={
                      coachVisible ? t("app.hideCoach") : t("app.showCoach")
                    }
                  >
                    <GraduationCapIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end">
                  <span>
                    {coachVisible ? t("app.hideCoach") : t("app.showCoach")}
                  </span>
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
          settingsMode={settingsMode}
          onExitSettings={() => navigateTo({ view: "chat", activeId })}
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
            onTurnsChange={setCoachTurns}
            onNavigateConversation={selectConversation}
            coachVisible={coachVisible}
          />
        </div>
        {secondaryView && (
          <div key={view} className="codex-secondary-view">
            {secondaryView}
          </div>
        )}
      </main>

      {coachVisible && (
        <aside className="codex-coach" tabIndex={-1}>
          <div
            className="codex-coach-resizer"
            onPointerDown={startCoachResize}
            title={t("sidebar.resizeTooltip")}
          />
          <CoachPanel
            turns={coachTurns}
            conversationId={activeId}
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
            aria-label={t("common.close")}
          >
            <XIcon size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
