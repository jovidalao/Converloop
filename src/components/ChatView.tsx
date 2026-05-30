import { useEffect, useRef, useState } from "react";
import { runTurn, MissingApiKeyError } from "../orchestrator";
import { loadChatHistory, type ChatTurn } from "../db/turns";
import { InlineCorrection } from "./InlineCorrection";
import { SpeakableText } from "./SpeakButton";
import { ReplyExplanation } from "./ReplyExplanation";
import { stopSpeech } from "../tts/playback";
import { autoSpeakReply } from "../tts/speak";

export function ChatView() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const turnGenRef = useRef(0);
  const replyCommittedRef = useRef(false);

  function syncStickToBottom() {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  function patchTurn(id: string, patch: Partial<ChatTurn>) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  useEffect(() => {
    void loadChatHistory().then(setTurns);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming]);

  function commitPartnerReply(turnId: string, reply: string) {
    patchTurn(turnId, { partnerText: reply });
    setStreaming("");
    setReplyBusy(false);
    void autoSpeakReply(reply);
  }

  async function send() {
    const text = input.trim();
    if (!text || replyBusy) return;
    stopSpeech();
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    stickToBottomRef.current = true;
    setInput("");
    setError(null);
    replyCommittedRef.current = false;
    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        userText: text,
        analysis: null,
        analysisPending: true,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    try {
      const result = await runTurn(text, {
        onReplyDelta: (d) => {
          acc += d;
          setStreaming(acc);
        },
        onReplyComplete: (reply) => {
          if (turnGenRef.current !== turnGen) return;
          replyCommittedRef.current = true;
          commitPartnerReply(turnId, reply);
        },
        onAnalysis: (a, opts) => {
          patchTurn(turnId, {
            analysis: a,
            analysisProse: opts?.proseFeedback ?? null,
            analysisPending: false,
            analysisError: opts?.error ?? null,
          });
        },
      });
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
      }
    } catch (e) {
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: "发送失败,本轮未批改",
      });
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
      }
    }
  }

  return (
    <div className="chat">
      <div
        className="messages"
        ref={messagesRef}
        onScroll={syncStickToBottom}
      >
        {turns.map((turn) => (
          <div key={turn.id} className="turn-block">
            <div className="turn-user">
              <div className="msg user">{turn.userText}</div>
              {(turn.analysisPending ||
                turn.analysis ||
                turn.analysisProse ||
                turn.analysisError) && (
                <InlineCorrection
                  analysis={turn.analysis}
                  proseFeedback={turn.analysisProse}
                  pending={!!turn.analysisPending}
                  error={turn.analysisError}
                />
              )}
            </div>
            {turn.partnerText && (
              <div className="turn-partner">
                <div className="msg partner">
                  <SpeakableText text={turn.partnerText} />
                </div>
                <ReplyExplanation text={turn.partnerText} />
              </div>
            )}
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
          disabled={replyBusy}
        />
        <button type="submit" disabled={replyBusy || !input.trim()}>
          {replyBusy ? "…" : "发送"}
        </button>
      </form>
    </div>
  );
}
