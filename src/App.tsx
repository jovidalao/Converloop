import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ChatView } from "./components/ChatView";
import { LearningAgentsView } from "./components/LearningAgentsView";
import { MasteryView } from "./components/MasteryView";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import { type MainView, Sidebar } from "./components/Sidebar";
import { Button } from "./components/ui/button";
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
import { withViewTransition } from "./lib/view-transition";

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
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 248;
  });

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  // ⌘, 设置 · ⌘B 侧栏(macOS 惯例)
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
      if (e.metaKey && e.key.toLowerCase() === "b" && !inField) {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const refresh = useCallback(
    () => listConversations().then(setConversations),
    [],
  );

  const refreshLearningAgents = useCallback(
    () => listLearningAgents().then(setLearningAgents),
    [],
  );

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

  function openDraftConversation() {
    const id = crypto.randomUUID();
    setDraftId(id);
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
  const topbarTitle =
    view === "profile"
      ? "学习者档案"
      : view === "mastery"
        ? "学习数据"
        : view === "learning"
          ? "创建专项课"
          : view === "settings"
            ? "设置"
            : draftActive
              ? "新对话"
              : (activeConversation?.title ?? "新对话");

  return (
    <div
      className="codex-shell"
      data-sidebar-collapsed={collapsed}
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
              <TooltipContent side="bottom" align="start" className="flex items-center gap-2">
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
          />
        </div>
        {view === "profile" && <ProfileView />}
        {view === "mastery" && <MasteryView />}
        {view === "learning" && (
          <LearningAgentsView onRefresh={refreshLearningAgents} />
        )}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
