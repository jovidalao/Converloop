import { PanelLeftIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
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

function App() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<MainView>("chat");
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(
    () => listConversations().then(setConversations),
    [],
  );

  useEffect(() => {
    void (async () => {
      const id = await ensureActiveConversation();
      setActiveId(id);
      await refresh();
    })();
  }, [refresh]);

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
      : view === "settings"
        ? "设置"
        : (conversations.find((c) => c.id === activeId)?.title ?? "");

  return (
    <div className="relative flex h-full min-h-screen">
      {!collapsed && (
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          view={view}
          onSelect={selectConversation}
          onNewChat={() => void newChat()}
          onRename={(id, t) => void rename(id, t)}
          onDelete={(id) => void remove(id)}
          onOpenView={setView}
          onToggleCollapse={() => setCollapsed(true)}
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
            onActivity={() => void refresh()}
          />
        </div>
        {view === "profile" && <ProfileView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
