import { PanelLeftIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
        setView("settings");
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
    setActiveId(id);
    setActiveConversationId(id);
    setView("chat");
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
    <div className="relative flex h-full min-h-screen">
      {!collapsed && (
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
          onOpenView={setView}
          onToggleCollapse={() => setCollapsed(true)}
          width={sidebarWidth}
          onResize={(w) =>
            setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
          }
        />
      )}
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 贯穿整宽的顶栏:既是窗口拖拽区,又做自顶向下的滚动渐变模糊 */}
        <div
          data-tauri-drag-region
          className={`absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-1.5 bg-background/60 backdrop-blur-lg backdrop-saturate-150 [mask-image:linear-gradient(to_bottom,#000_52%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_52%,transparent)] ${
            collapsed ? "pl-20" : "px-5"
          }`}
        >
          {collapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => setCollapsed(false)}
              title="展开侧栏"
              aria-label="展开侧栏"
            >
              <PanelLeftIcon />
            </Button>
          )}
          <span className="pointer-events-none truncate text-sm font-semibold tracking-tight">
            {topbarTitle}
          </span>
        </div>
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
