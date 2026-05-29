import { useState } from "react";
import { ChatView } from "./components/ChatView";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import "./App.css";

type Tab = "chat" | "profile" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "聊天" },
  { id: "profile", label: "档案" },
  { id: "settings", label: "设置" },
];

function App() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="app">
      <nav className="tabs">
        <span className="brand">lang-agent</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="view">
        {tab === "chat" && <ChatView />}
        {tab === "profile" && <ProfileView />}
        {tab === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

export default App;
