import { useEffect, useState } from "react";
import { runMasteryProbe, type ProbeResult } from "./db/probe";
import "./App.css";

function App() {
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [running, setRunning] = useState(false);

  async function probe() {
    setRunning(true);
    setResult(await runMasteryProbe());
    setRunning(false);
  }

  // 启动即跑一次,验证 migration 在 Database.load 时已执行。
  useEffect(() => {
    void probe();
  }, []);

  return (
    <main className="container">
      <h1>lang-agent · SQLite 探针</h1>
      <p>Task 1:Drizzle (sqlite-proxy) + tauri-plugin-sql 读写 mastery_item</p>

      <button onClick={probe} disabled={running}>
        {running ? "运行中…" : "重新运行探针"}
      </button>

      {result && (
        <pre
          style={{
            textAlign: "left",
            background: result.ok ? "#0a2a0a" : "#2a0a0a",
            color: "#ddd",
            padding: "1rem",
            borderRadius: 8,
            overflowX: "auto",
          }}
        >
          {result.ok ? "✅ " : "❌ "}
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}

export default App;
