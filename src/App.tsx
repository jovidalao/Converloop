import { PanelLeftIcon, PanelRightIcon } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { LearningAgentsView } from "./components/LearningAgentsView";
import { MasteryView } from "./components/MasteryView";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import { type MainView, Sidebar } from "./components/Sidebar";
import { Button } from "./components/ui/button";
import {
  type ConversationMeta,
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<MainView>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 248;
  });

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  // ⌘, 打开设置(macOS 偏好设置惯例)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        withViewTransition(() => setView("settings"));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const refresh = useCallback(
    () => listConversations().then(setConversations),
    [],
  );

  const refreshLearningAgents = useCallback(
    () => listLearningAgents().then(setLearningAgents),
    [],
  );

  useEffect(() => {
    void (async () => {
      await ensureBuiltInLearningAgents();
      await refreshLearningAgents();
      const id = await ensureActiveConversation();
      setActiveId(id);
      await refresh();
    })();
  }, [refresh, refreshLearningAgents]);

  function selectConversation(id: string) {
    setActiveConversationId(id); // 持久化,不进过渡
    withViewTransition(() => {
      setActiveId(id);
      setView("chat");
    });
  }

  async function newChat() {
    const id = await createConversation();
    await refresh();
    selectConversation(id);
  }

  async function startLearningAgent(agentId: string) {
    const agent = learningAgents.find((a) => a.id === agentId);
    const title = `专项课 · ${agent?.name ?? "定制化学习"}`;
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
      const nextId = rest[0]?.id ?? (await createConversation());
      if (!rest[0]) await refresh();
      selectConversation(nextId);
    }
  }

  if (!activeId)
    return (
      <div className="flex h-full min-h-screen items-center justify-center text-muted-foreground">
        加载中…
      </div>
    );

  const topbarTitle =
    view === "profile"
      ? "学习者档案"
      : view === "mastery"
        ? "学习数据"
        : view === "learning"
          ? "定制化学习 Agent"
          : view === "settings"
            ? "设置"
            : (conversations.find((c) => c.id === activeId)?.title ?? "");
  const activeConversation = conversations.find((c) => c.id === activeId);

  return (
    <div
      className="codex-shell"
      data-sidebar-collapsed={collapsed}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <header className="codex-topbar" data-tauri-drag-region>
        <div className="codex-topbar-left">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="codex-chrome-button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? <PanelRightIcon /> : <PanelLeftIcon />}
          </Button>
        </div>
        <div className="codex-titlebar">
          <span className="truncate">{topbarTitle}</span>
        </div>
      </header>

      <Sidebar
        conversations={conversations}
        learningAgents={learningAgents}
        activeId={activeId}
        view={view}
        onSelect={selectConversation}
        onNewChat={() => void newChat()}
        onStartLearningAgent={(id) => void startLearningAgent(id)}
        onRename={(id, t) => void rename(id, t)}
        onDelete={(id) => void remove(id)}
        onOpenView={(v) => withViewTransition(() => setView(v))}
        width={sidebarWidth}
        onResize={(w) =>
          setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
        }
      />

      <main className="vt-main codex-main relative flex min-h-0 flex-col overflow-hidden">
        <div
          className="flex min-h-0 flex-1 flex-col data-[hidden=true]:hidden"
          data-hidden={view !== "chat"}
        >
          <ChatView
            key={activeId}
            conversationId={activeId}
            mode={activeConversation?.kind ?? "practice"}
            onActivity={() => void refresh()}
          />
        </div>
        {view === "profile" && <ProfileView />}
        {view === "mastery" && <MasteryView />}
        {view === "learning" && (
          <LearningAgentsView
            agents={learningAgents}
            onRefresh={refreshLearningAgents}
            onStart={(id) => void startLearningAgent(id)}
          />
        )}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
