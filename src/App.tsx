import { useCallback, useEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar, type MainView } from "./components/Sidebar";
import {
  type ConversationMeta,
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  ensureActiveConversation,
  setActiveConversationId,
} from "./db/conversations";
import "./App.css";

function App() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<MainView>("chat");

  const refresh = useCallback(() => listConversations().then(setConversations), []);

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

  if (!activeId) return <div className="app loading">加载中…</div>;

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        view={view}
        onSelect={selectConversation}
        onNewChat={() => void newChat()}
        onRename={(id, t) => void rename(id, t)}
        onDelete={(id) => void remove(id)}
        onOpenView={setView}
      />
      <main className="view">
        <div className="view-panel" hidden={view !== "chat"}>
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
