import { useEffect, useRef, useState } from "react";
import { runTurn, MissingApiKeyError } from "../orchestrator";
import type { TutorAnalysis } from "../agents/schema";
import { CorrectionPanel } from "./CorrectionPanel";

interface ChatMsg {
  role: "user" | "partner";
  text: string;
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [analysis, setAnalysis] = useState<TutorAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setAnalysis(null);
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    setStreaming("");
    let acc = "";
    try {
      const result = await runTurn(text, {
        onReplyDelta: (d) => {
          acc += d;
          setStreaming(acc);
        },
        onAnalysis: (a) => setAnalysis(a),
      });
      setMessages((m) => [...m, { role: "partner", text: result.reply }]);
    } catch (e) {
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setStreaming("");
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-main">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {streaming && <div className="msg partner streaming">{streaming}</div>}
          <div ref={endRef} />
        </div>
        {error && <div className="error">{error}</div>}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="用目标语言输入一句话…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? "…" : "发送"}
          </button>
        </form>
      </div>
      <CorrectionPanel analysis={analysis} busy={busy} />
    </div>
  );
}
