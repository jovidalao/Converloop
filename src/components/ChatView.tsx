import {
  ArrowUpIcon,
  BookmarkPlusIcon,
  CheckIcon,
  CopyIcon,
  LanguagesIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TutorAnalysis } from "../agents/schema";
import { useConfig } from "../config";
import { maybeAutoTitle, touchConversation } from "../db/conversations";
import {
  type ChatTurn,
  incrementBilingualCount,
  incrementExplainCount,
  loadChatHistory,
} from "../db/turns";
import { bilingualReply, MissingApiKeyError, runTurn } from "../orchestrator";
import { appendMyNote } from "../profile/notes";
import { loadTtsConfig } from "../tts/config";
import { stopSpeech } from "../tts/playback";
import { createReplySpeaker } from "../tts/stream";
import { InlineCorrection, UserSentence } from "./InlineCorrection";
import { Markdown } from "./Markdown";
import { ReplyExplanation } from "./ReplyExplanation";
import { SpeakButton } from "./SpeakButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

interface ChatViewProps {
  conversationId: string;
  /** 本会话新一轮持久化后触发(标题可能变了、排序要刷新)。 */
  onActivity?: () => void;
}

// 复制这条回复。复制后短暂显示对勾。
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      title="复制"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
    </Button>
  );
}

// 一条 AI 回复:气泡(原文 / 双语对照可切换)+ 操作行(复制 / 朗读 / 讲解 / 双语阅读)。
// 双语对照按需 AI 生成、替换显示原文,再点恢复;状态留在组件内,不持久化。
// 关键:朗读始终读原文(目标语言版),SpeakButton 永远拿原始 text。
function PartnerReply({
  text,
  autoOpen = false,
  onFirstExplain,
  onFirstBilingual,
}: {
  text: string;
  autoOpen?: boolean;
  /** 用户首次主动点开讲解/双语时各触发一次(理解信号记账;自动展开不算)。 */
  onFirstExplain?: () => void;
  onFirstBilingual?: () => void;
}) {
  const [open, setOpen] = useState(false); // 当前是否显示双语对照
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<string | null>(null); // 双语 Markdown
  const [error, setError] = useState<string | null>(null);
  const didAutoOpen = useRef(false);

  async function generate() {
    setLoading(true);
    setError(null);
    setView(null);
    try {
      setView(await bilingualReply(text));
    } catch (e) {
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (loading) return;
    if (!view && !error) {
      setOpen(true);
      onFirstBilingual?.(); // 用户主动请求双语对照 → 理解吃力信号
      void generate();
      return;
    }
    setOpen((o) => !o);
  }

  // 设置里开了「自动开启双语阅读」时,新回复挂载即展开并生成一次。
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when autoOpen flips, guarded by didAutoOpen ref; adding generate would re-fire every render
  useEffect(() => {
    if (autoOpen && !didAutoOpen.current) {
      didAutoOpen.current = true;
      setOpen(true);
      void generate();
    }
  }, [autoOpen]);

  const showBilingual = open && (view || error);

  return (
    <div className="flex max-w-none flex-col items-start gap-1.5 self-stretch">
      <div className="self-stretch py-0.5 text-foreground">
        {showBilingual && error ? (
          <span className="text-sm leading-snug text-destructive" role="alert">
            {error}
          </span>
        ) : showBilingual && view ? (
          <Markdown
            className="bilingual"
            components={{
              em: ({ children }) => <span className="bi-tr">{children}</span>,
            }}
          >
            {view}
          </Markdown>
        ) : (
          <Markdown>{text}</Markdown>
        )}
      </div>
      <ReplyExplanation
        text={text}
        onFirstOpen={onFirstExplain}
        actions={
          <>
            <CopyButton text={text} />
            <SpeakButton text={text} />
          </>
        }
        trailingActions={
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={!!showBilingual}
            onClick={toggle}
            disabled={loading}
            aria-pressed={!!showBilingual}
            title="目标语言/母语逐句对照"
          >
            {loading ? <Spinner /> : <LanguagesIcon size={16} />}
            <span>双语阅读</span>
          </Button>
        }
      />
    </div>
  );
}

// 「更地道」改写:仅纯目标语轮,有且与改正句不同才返回,否则 null。
// 直接显示在用户气泡内(分割线下方),不再用 toggle 面板。
function idiomaticText(analysis: TutorAnalysis | null): string | null {
  if (!analysis || analysis.expression_gap) return null;
  const natural = analysis.natural?.trim();
  if (!natural) return null;
  const corrected = analysis.corrected?.trim();
  return natural === corrected ? null : natural;
}

// 用户消息操作:复制 + 朗读。朗读优先读「地道表达」改写,没有则读纠正后的句子。
// 作为 leading 渲染进批改操作行,排在切换按钮左边(同一行)。
// 母语/混说轮(expression_gap)没有目标语正句可读,所以不显示朗读。
function UserMessageActions({ turn }: { turn: ChatTurn }) {
  const analysis = turn.analysis;
  const corrected = analysis?.corrected?.trim() || turn.userText;
  const speakTarget = idiomaticText(analysis) ?? corrected;
  const canSpeak = !!analysis && !analysis.expression_gap;
  return (
    <>
      <CopyButton text={corrected} />
      {canSpeak && <SpeakButton text={speakTarget} />}
    </>
  );
}

// 用户这一轮:气泡(原句 + 可切换的「地道表达」改写)+ 操作行 / 批改。
// 「地道表达」的开关状态留在这里,同时驱动气泡内容和操作行里的切换按钮。
function UserTurn({
  turn,
  nativeLanguage,
}: {
  turn: ChatTurn;
  nativeLanguage: string;
}) {
  const idiomatic = idiomaticText(turn.analysis);
  const [naturalOpen, setNaturalOpen] = useState(true);
  return (
    <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1.5 self-end">
      <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-base leading-normal text-foreground shadow-sm">
        <UserSentence
          text={turn.userText}
          analysis={turn.analysis}
          nativeLanguage={nativeLanguage}
        />
        {idiomatic && naturalOpen && (
          <div className="mt-2 flex items-start gap-1.5 border-t pt-2 text-sm leading-normal text-muted-foreground">
            <span
              className="mt-0.5 inline-flex shrink-0 text-primary"
              aria-hidden
            >
              <SparklesIcon size={14} />
            </span>
            <span className="min-w-0 flex-1">{idiomatic}</span>
          </div>
        )}
      </div>
      <InlineCorrection
        analysis={turn.analysis}
        proseFeedback={turn.analysisProse}
        pending={!!turn.analysisPending}
        error={turn.analysisError}
        leading={<UserMessageActions turn={turn} />}
        natural={
          idiomatic
            ? { open: naturalOpen, onToggle: () => setNaturalOpen((v) => !v) }
            : undefined
        }
      />
    </div>
  );
}

export function ChatView({ conversationId, onActivity }: ChatViewProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const turnGenRef = useRef(0);
  const replyCommittedRef = useRef(false);
  const liveTurnIdsRef = useRef<Set<string>>(new Set()); // 本会话内新发的轮次,自动双语只作用于它们
  const { nativeLanguage, autoBilingual } = useConfig();

  // 输入框随内容增高,最多三行,超过后内部滚动。
  // biome-ignore lint/correctness/useExhaustiveDependencies: input is the intentional trigger; the effect reads inputRef after it changes, not input directly
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
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  useEffect(() => {
    void loadChatHistory(conversationId).then(setTurns);
  }, [conversationId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: turns/streaming are intentional scroll triggers; the effect reads refs only
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming]);

  function commitPartnerReply(turnId: string, reply: string) {
    patchTurn(turnId, { partnerText: reply });
    setStreaming("");
    setReplyBusy(false);
  }

  // 把当前输入记进档案的「我的笔记」(用户主笔、AI 不改、对话 agent 会读到)。
  // 纯代码写 MD,不发起对话轮,不调用 LLM。
  async function remember() {
    const text = input.trim();
    if (!text || replyBusy) return;
    try {
      await appendMyNote(text);
      setInput("");
      setError(null);
      setNotice("已记住 —— 写入档案「我的笔记」,之后对话会记得。");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(`记住失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || replyBusy) return;
    stopSpeech();
    const isFirstMessage = turns.length === 0;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
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
    // 边收流边分句朗读:第一句一就绪即出声,后续句子在后台合成、无缝续播。
    // 设置里关掉「自动朗读」时不创建朗读会话(小喇叭仍可手动朗读)。
    const speaker = loadTtsConfig().autoSpeak ? createReplySpeaker() : null;
    try {
      const result = await runTurn(text, conversationId, {
        onReplyDelta: (d) => {
          acc += d;
          setStreaming(acc);
          speaker?.push(acc);
        },
        onReplyComplete: (reply) => {
          if (turnGenRef.current !== turnGen) return;
          replyCommittedRef.current = true;
          commitPartnerReply(turnId, reply);
          speaker?.finish(reply);
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
        speaker?.finish(result.reply);
      }
      // 轮次已持久化:更新会话排序,首条消息顺带自动命名,再刷新侧边栏。
      await touchConversation(conversationId);
      if (isFirstMessage) await maybeAutoTitle(conversationId, text);
      onActivity?.();
    } catch (e) {
      stopSpeech(); // 出错则停掉已在播的分句,并让朗读会话失效。
      speaker?.abort();
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
      } else {
        speaker?.abort(); // 轮次已被新消息取代,停止本轮合成(播放已由新 send 的 stopSpeech 接管)。
      }
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-14 pb-3"
        ref={messagesRef}
        onScroll={syncStickToBottom}
      >
        {turns.length === 0 && !streaming && (
          <div className="m-auto text-center text-sm leading-relaxed text-muted-foreground">
            用目标语言说点什么,开始对话吧。
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-2">
            <UserTurn turn={turn} nativeLanguage={nativeLanguage} />
            {turn.partnerText && (
              <PartnerReply
                text={turn.partnerText}
                autoOpen={autoBilingual && liveTurnIdsRef.current.has(turn.id)}
                onFirstExplain={() => void incrementExplainCount(turn.id)}
                onFirstBilingual={() => void incrementBilingualCount(turn.id)}
              />
            )}
          </div>
        ))}
        {streaming && (
          <div className="self-stretch py-0.5 text-foreground opacity-70">
            <Markdown>{streaming}</Markdown>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && (
        <div className="mx-4 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="mx-4 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
          {notice}
        </div>
      )}
      <div className="shrink-0 px-4 pt-1.5 pb-4">
        <form
          className="flex items-end gap-1.5 rounded-3xl border bg-card py-1.5 pr-1.5 pl-4 shadow transition-colors focus-within:border-ring"
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
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="用目标语言输入一句话…"
            disabled={replyBusy}
            className="max-h-[calc(1.4em*3+0.9rem)] min-w-0 flex-1 resize-none border-none bg-transparent py-2 text-base leading-snug outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-muted-foreground"
            disabled={replyBusy || !input.trim()}
            onClick={() => void remember()}
            title="记住这句(写入档案「我的笔记」,AI 不会改,对话会记得)"
            aria-label="记住这句"
          >
            <BookmarkPlusIcon className="size-4.5" />
          </Button>
          <Button
            type="submit"
            size="icon"
            className="size-9 rounded-full"
            disabled={replyBusy || !input.trim()}
            title="发送"
            aria-label="发送"
          >
            {replyBusy ? (
              <Spinner className="size-3.5" />
            ) : (
              <ArrowUpIcon className="size-4.5" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
