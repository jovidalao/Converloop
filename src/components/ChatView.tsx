import { useEffect, useRef, useState } from "react";
import { runTurn, MissingApiKeyError } from "../orchestrator";
import { loadChatHistory, type ChatTurn } from "../db/turns";
import { loadConfig } from "../config";
import { maybeAutoTitle, touchConversation } from "../db/conversations";
import { InlineCorrection, UserSentence } from "./InlineCorrection";
import { SpeakButton } from "./SpeakButton";
import { ReplyExplanation } from "./ReplyExplanation";
import { IconCopy, IconCheck, IconSend } from "./icons";
import { stopSpeech } from "../tts/playback";
import { autoSpeakReply } from "../tts/speak";

interface ChatViewProps {
  conversationId: string;
  /** 本会话新一轮持久化后触发(标题可能变了、排序要刷新)。 */
  onActivity?: () => void;
}

// 复制这条回复。复制后短暂显示对勾。
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="msg-action"
      title="复制"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
    </button>
  );
}

// 用户消息下方的操作:复制 + 朗读「纠正后的句子」。
// 母语/混说轮(expression_gap)没有目标语正句可读,所以不显示朗读。
function UserMessageActions({ turn }: { turn: ChatTurn }) {
  const analysis = turn.analysis;
  const corrected = analysis?.corrected?.trim() || turn.userText;
  const canSpeak = !!analysis && !analysis.expression_gap;
  return (
    <div className="msg-actions user">
      <CopyButton text={corrected} />
      {canSpeak && <SpeakButton text={corrected} />}
    </div>
  );
}

export function ChatView({ conversationId, onActivity }: ChatViewProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const turnGenRef = useRef(0);
  const replyCommittedRef = useRef(false);
  const [nativeLanguage] = useState(() => loadConfig().nativeLanguage);

  // 输入框随内容增高,最多三行,超过后内部滚动。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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
    void loadChatHistory(conversationId).then(setTurns);
  }, [conversationId]);

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
    const isFirstMessage = turns.length === 0;
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
      const result = await runTurn(text, conversationId, {
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
      // 轮次已持久化:更新会话排序,首条消息顺带自动命名,再刷新侧边栏。
      await touchConversation(conversationId);
      if (isFirstMessage) await maybeAutoTitle(conversationId, text);
      onActivity?.();
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
              <div className="msg user">
                <UserSentence
                  text={turn.userText}
                  analysis={turn.analysis}
                  nativeLanguage={nativeLanguage}
                />
              </div>
              <UserMessageActions turn={turn} />
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
                <div className="msg partner">{turn.partnerText}</div>
                <ReplyExplanation
                  text={turn.partnerText}
                  actions={
                    <>
                      <CopyButton text={turn.partnerText} />
                      <SpeakButton text={turn.partnerText} />
                    </>
                  }
                />
              </div>
            )}
          </div>
        ))}
        {streaming && <div className="msg partner streaming">{streaming}</div>}
        <div ref={endRef} />
      </div>
      {error && <div className="error">{error}</div>}
      <div className="composer-dock">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="用目标语言输入一句话…"
            disabled={replyBusy}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={replyBusy || !input.trim()}
            title="发送"
          >
            {replyBusy ? (
              <span className="send-spinner" aria-hidden />
            ) : (
              <IconSend size={18} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
