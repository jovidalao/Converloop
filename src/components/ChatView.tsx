import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchIcon,
  LanguagesIcon,
  PencilIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TutorAnalysis } from "../agents/schema";
import { useConfig } from "../config";
import {
  getConversation,
  maybeAutoTitle,
  type NewConversationContext,
  parseAgentModifiers,
  touchConversation,
  truncateConversationFrom,
} from "../db/conversations";
import {
  type ChatTurn,
  incrementBilingualCount,
  incrementExplainCount,
  loadChatHistory,
} from "../db/turns";
import {
  bilingualReply,
  MissingApiKeyError,
  regenerateReply,
  runTurn,
  startDerivedConversation,
  startLearningSession,
} from "../orchestrator";
import { beginAction, getActions, isAgentEnabled } from "../runtime";
import { loadTtsConfig } from "../tts/config";
import { stopSpeech } from "../tts/playback";
import { createReplySpeaker } from "../tts/stream";
import { useConfirm } from "./confirm";
import { InlineCorrection, UserSentence } from "./InlineCorrection";
import { Markdown } from "./Markdown";
import { ReplyExplanation } from "./ReplyExplanation";
import { SpeakButton } from "./SpeakButton";
import { TranslationPopover } from "./TranslationPopover";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

interface ChatViewProps {
  conversationId: string;
  isDraft?: boolean;
  mode?: "practice" | "learning_agent";
  /** 本会话新一轮持久化后触发(标题可能变了、排序要刷新)。 */
  onActivity?: () => void;
  /** 新对话草稿首轮成功持久化后,补建真实 conversation 行。 */
  onCreateDraftConversation?: (id: string) => Promise<void>;
  /** 把最新一轮上报给右栏教练面板;批改到达时会再次上报(只读,不改本组件逻辑)。 */
  onActiveTurnChange?: (turn: ChatTurn | null) => void;
  /** 会话动作创建分支后切换到新会话(由 App 提供)。 */
  onNavigateConversation?: (id: string) => void;
  /** 教练面板是否可见:可见时气泡内批改精简,详情只在右栏,避免双份。 */
  coachVisible?: boolean;
}

// 回复到达前的「正在输入」提示:三点跳动。首 token 一来就被流式文本取代。
function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      role="status"
      aria-label="正在输入"
    >
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
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

// 「从此处开始」:把这条用户消息的文字放回输入框重新编辑,并舍弃它(含)之后的所有对话。
// 已记入学习记忆的内容不受影响(只删对话 turn)。
function EditFromHereButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      title={
        disabled
          ? "正在批改,完成后即可从此处重新编辑"
          : "从此处开始:重新编辑这句,舍弃其后的对话"
      }
      disabled={disabled}
      onClick={onClick}
    >
      <PencilIcon size={16} />
    </Button>
  );
}

// 一条 AI 回复:气泡(原文 / 双语对照可切换)+ 操作行(复制 / 朗读 / 讲解 / 双语阅读)。
// 双语对照按需 AI 生成、替换显示原文,再点恢复;状态留在组件内,不持久化。
// 关键:朗读始终读原文(目标语言版),SpeakButton 永远拿原始 text。
function PartnerReply({
  text,
  autoOpen = false,
  learningMode = false,
  onFirstExplain,
  onFirstBilingual,
  onLayoutChange,
  onRegenerate,
  regenerating = false,
}: {
  text: string;
  autoOpen?: boolean;
  learningMode?: boolean;
  /** 用户首次主动点开讲解/双语时各触发一次(理解信号记账;自动展开不算)。 */
  onFirstExplain?: () => void;
  onFirstBilingual?: () => void;
  onLayoutChange?: () => void;
  /** 提供时显示「重新生成回复」按钮(仅挂在最新一条回复上)。 */
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const [open, setOpen] = useState(false); // 当前是否显示双语对照
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<string | null>(null); // 双语 Markdown
  const [error, setError] = useState<string | null>(null);
  const didAutoOpen = useRef(false);
  const prevTextRef = useRef(text);

  // 回复被「重新生成」替换后,旧的双语对照不再对应,收起重置(首次挂载不动,避免和 autoOpen 打架)。
  useEffect(() => {
    if (prevTextRef.current === text) return;
    prevTextRef.current = text;
    setOpen(false);
    setView(null);
    setError(null);
  }, [text]);

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

  useEffect(() => {
    if (open || loading || view || error) onLayoutChange?.();
  }, [open, loading, view, error, onLayoutChange]);

  const showBilingual = open && (view || error);

  if (learningMode) {
    return (
      <div className="flex max-w-none flex-col items-start gap-1.5 self-stretch">
        <div
          className="self-stretch py-0.5 text-foreground"
          data-selectable-context
        >
          <Markdown>{text}</Markdown>
        </div>
        <div className="-ml-1 flex items-center gap-0.5">
          <CopyButton text={text} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-none flex-col items-start gap-1.5 self-stretch">
      <div
        className="self-stretch py-0.5 text-foreground"
        data-selectable-context
      >
        {showBilingual && error ? (
          <div className="flex items-center gap-3">
            <span
              className="min-w-0 flex-1 text-sm leading-snug text-destructive"
              role="alert"
            >
              {error}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5"
              disabled={loading}
              onClick={() => void generate()}
            >
              <RefreshCwIcon size={14} />
              重试
            </Button>
          </div>
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
            {onRegenerate && (
              <Button
                type="button"
                variant="action"
                size="action"
                title="重新生成回复"
                onClick={onRegenerate}
                disabled={regenerating}
              >
                {regenerating ? <Spinner /> : <RefreshCwIcon size={16} />}
              </Button>
            )}
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
function UserMessageActions({
  turn,
  onEditFrom,
  onTurnAction,
  editDisabled = false,
}: {
  turn: ChatTurn;
  onEditFrom: () => void;
  // 注册表驱动的 turn 级动作(如「从此处分支」);新增动作无需改本组件。
  onTurnAction: (actionId: string) => void;
  // 任一轮还在批改时禁用「从此处开始」——截断会丢弃在途批改。
  editDisabled?: boolean;
}) {
  const analysis = turn.analysis;
  const corrected = analysis?.corrected?.trim() || turn.userText;
  const speakTarget = idiomaticText(analysis) ?? corrected;
  const canSpeak = !!analysis && !analysis.expression_gap;
  return (
    <>
      <CopyButton text={corrected} />
      {canSpeak && <SpeakButton text={speakTarget} />}
      <EditFromHereButton onClick={onEditFrom} disabled={editDisabled} />
      {getActions("turn")
        .filter((a) => isAgentEnabled(a.id))
        .map((a) => (
          <Button
            key={a.id}
            type="button"
            variant="action"
            size="action"
            title={`${a.label}:${a.description ?? ""}`}
            onClick={() => onTurnAction(a.id)}
          >
            <GitBranchIcon size={16} />
          </Button>
        ))}
    </>
  );
}

// 用户这一轮:气泡(原句 + 可切换的「地道表达」改写)+ 操作行 / 批改。
// 「地道表达」的开关状态留在这里,同时驱动气泡内容和操作行里的切换按钮。
function UserTurn({
  turn,
  nativeLanguage,
  learningMode,
  coachVisible,
  onEditFrom,
  onTurnAction,
  editDisabled = false,
}: {
  turn: ChatTurn;
  nativeLanguage: string;
  learningMode: boolean;
  coachVisible: boolean;
  onEditFrom: () => void;
  onTurnAction: (actionId: string) => void;
  editDisabled?: boolean;
}) {
  const idiomatic = idiomaticText(turn.analysis);
  const [naturalOpen, setNaturalOpen] = useState(true);
  if (learningMode) {
    return (
      <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1.5 self-end">
        <div
          className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-base leading-normal text-foreground shadow-sm"
          data-selectable-context
        >
          {turn.userText}
        </div>
        <div className="-mr-1 flex items-center gap-0.5">
          <CopyButton text={turn.userText} />
          <EditFromHereButton onClick={onEditFrom} disabled={editDisabled} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1.5 self-end">
      <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-base leading-normal text-foreground shadow-sm">
        <UserSentence
          text={turn.userText}
          analysis={turn.analysis}
          nativeLanguage={nativeLanguage}
        />
        {idiomatic && naturalOpen && !coachVisible && (
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
        compact={coachVisible}
        leading={
          <UserMessageActions
            turn={turn}
            onEditFrom={onEditFrom}
            onTurnAction={onTurnAction}
            editDisabled={editDisabled}
          />
        }
        natural={
          idiomatic && !coachVisible
            ? { open: naturalOpen, onToggle: () => setNaturalOpen((v) => !v) }
            : undefined
        }
      />
    </div>
  );
}

// 哪些衍生会话的上下文面板已经看过:首次进入默认展开一次,之后默认折叠。
const DERIVED_BANNER_SEEN_KEY = "lang-agent.derivedBannerSeen";

function hasSeenDerivedBanner(id: string): boolean {
  try {
    const arr = JSON.parse(
      localStorage.getItem(DERIVED_BANNER_SEEN_KEY) ?? "[]",
    );
    return Array.isArray(arr) && arr.includes(id);
  } catch {
    return false;
  }
}

function markDerivedBannerSeen(id: string): void {
  try {
    const arr = JSON.parse(
      localStorage.getItem(DERIVED_BANNER_SEEN_KEY) ?? "[]",
    );
    const list: string[] = Array.isArray(arr) ? arr : [];
    if (!list.includes(id)) {
      list.push(id);
      // 封顶避免无限增长。
      localStorage.setItem(
        DERIVED_BANNER_SEEN_KEY,
        JSON.stringify(list.slice(-200)),
      );
    }
  } catch {
    // localStorage 不可用时无所谓,只是退化为每次都展开。
  }
}

// 衍生会话顶部:展示这个 Agent 生成的对话上下文(场景/角色/难度/衔接等)。
// 首次进入默认展开,看过后默认折叠;让用户知道「这条对话从哪来、按什么设定衍生」。
function DerivedContextBanner({
  conversationId,
  context,
  label,
}: {
  conversationId: string;
  context: NewConversationContext;
  label?: string;
}) {
  const [open, setOpen] = useState(() => !hasSeenDerivedBanner(conversationId));
  useEffect(() => {
    markDerivedBannerSeen(conversationId);
  }, [conversationId]);
  const rows: [string, string][] = [
    ["场景", context.scenario],
    ["你的角色", context.userRole],
    ["AI 角色", context.aiRole],
    ["难度", context.difficulty],
    ["衔接", context.continuitySummary],
    ["开场", context.openingInstruction],
    ["约束", context.constraints.join(" / ")],
  ];
  return (
    <div className="rounded-lg border bg-muted/40 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="shrink-0" aria-hidden>
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
        </span>
        <span className="shrink-0 text-primary" aria-hidden>
          <SparklesIcon size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {label ? `${label} · ` : ""}由 Agent 衍生生成的对话上下文
        </span>
      </button>
      {open && (
        <dl className="space-y-2 border-t px-3 py-2.5 text-foreground">
          {rows
            .filter(([, value]) => value.trim())
            .map(([key, value]) => (
              <div key={key} className="flex gap-2.5">
                <dt className="w-14 shrink-0 text-muted-foreground">{key}</dt>
                <dd className="min-w-0 flex-1 leading-snug">{value}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

export function ChatView({
  conversationId,
  isDraft = false,
  mode = "practice",
  onActivity,
  onCreateDraftConversation,
  onActiveTurnChange,
  onNavigateConversation,
  coachVisible = false,
}: ChatViewProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [layoutTick, setLayoutTick] = useState(0);
  const [replyBusy, setReplyBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [derivationPreparing, setDerivationPreparing] = useState(false);
  // 衍生会话的上下文(顶部折叠展示);非衍生会话为 null。
  const [derivedBanner, setDerivedBanner] = useState<{
    context: NewConversationContext;
    label?: string;
  } | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 上一次失败操作的重试入口(发送 / 重新生成 / 专项课启动共用底部错误条)。
  const [retry, setRetry] = useState<{ run: () => void } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const turnGenRef = useRef(0);
  const replyCommittedRef = useRef(false);
  const kickoffStartedRef = useRef(false);
  const derivationStartedRef = useRef(false);
  const liveTurnIdsRef = useRef<Set<string>>(new Set()); // 本会话内新发的轮次,自动双语只作用于它们
  const { nativeLanguage, autoBilingual } = useConfig();
  const confirm = useConfirm();
  const learningMode = mode === "learning_agent";

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

  const requestLayoutScroll = useCallback(() => {
    setLayoutTick((n) => n + 1);
  }, []);

  function patchTurn(id: string, patch: Partial<ChatTurn>) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: kickoff functions read current conversation state; this effect intentionally runs only on conversation/mode switch
  useEffect(() => {
    let cancelled = false;
    setDerivedBanner(null);
    void loadChatHistory(conversationId).then(async (loaded) => {
      if (cancelled) return;
      setTurns(loaded);
      if (learningMode && loaded.length === 0 && !kickoffStartedRef.current) {
        void startLesson();
        return;
      }
      if (!learningMode) {
        const conv = await getConversation(conversationId);
        if (cancelled) return;
        const mods = parseAgentModifiers(conv?.agentModifiersJson ?? null);
        if (mods.derivedContext)
          setDerivedBanner({
            context: mods.derivedContext,
            label: mods.derivation?.actionLabel,
          });
        if (
          loaded.length === 0 &&
          !derivationStartedRef.current &&
          mods.derivation?.status === "pending"
        )
          void startDerived();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, learningMode]);

  // 最新一轮上报给教练面板。turns 在批改到达时会被 patch(新对象),故 analysis 一到就自动重报。
  useEffect(() => {
    onActiveTurnChange?.(turns.length ? turns[turns.length - 1] : null);
  }, [turns, onActiveTurnChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: turns/streaming/layoutTick are intentional scroll triggers; the effect reads refs only
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming, layoutTick]);

  function commitPartnerReply(turnId: string, reply: string) {
    patchTurn(turnId, { partnerText: reply });
    setStreaming("");
    setReplyBusy(false);
  }

  async function startLesson(replacingId?: string) {
    if (!learningMode || replyBusy || kickoffStartedRef.current) return;
    stopSpeech();
    kickoffStartedRef.current = true;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setTurns((prev) => [
      ...(replacingId ? prev.filter((t) => t.id !== replacingId) : prev),
      {
        id: turnId,
        userText: "",
        analysis: null,
        analysisPending: false,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    try {
      const result = await startLearningSession(
        conversationId,
        {
          onReplyDelta: (d) => {
            acc += d;
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            commitPartnerReply(turnId, reply);
          },
          onAnalysis: () => {
            patchTurn(turnId, { analysisPending: false });
          },
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
      }
      await touchConversation(conversationId);
      onActivity?.();
    } catch (e) {
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: "专项课启动失败",
      });
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      // 放开 kickoff 守卫,让重试可以重新发起;重试时换掉这条失败轮次。
      kickoffStartedRef.current = false;
      setRetry({ run: () => void startLesson(turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
      }
    }
  }

  async function startDerived(replacingId?: string) {
    if (learningMode || replyBusy || derivationStartedRef.current) return;
    stopSpeech();
    derivationStartedRef.current = true;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setDerivationPreparing(true);
    setTurns((prev) => [
      ...(replacingId ? prev.filter((t) => t.id !== replacingId) : prev),
      {
        id: turnId,
        userText: "",
        analysis: null,
        analysisPending: false,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    // 衍生会话的开场同样自动朗读(与普通发送一致),关掉自动朗读时不创建。
    const speaker = loadTtsConfig().autoSpeak ? createReplySpeaker() : null;
    try {
      const result = await startDerivedConversation(
        conversationId,
        {
          onReplyDelta: (d) => {
            if (turnGenRef.current !== turnGen) return;
            acc += d;
            setDerivationPreparing(false);
            setStreaming(acc);
          },
          onReplyComplete: (reply) => {
            if (turnGenRef.current !== turnGen) return;
            replyCommittedRef.current = true;
            setDerivationPreparing(false);
            commitPartnerReply(turnId, reply);
            speaker?.finish(reply);
          },
          onAnalysis: () => {
            patchTurn(turnId, { analysisPending: false });
          },
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        setDerivationPreparing(false);
        commitPartnerReply(turnId, result.reply);
        speaker?.finish(result.reply);
      }
      // 上下文已由 orchestrator 写回会话;读出来点亮顶部折叠面板。
      const conv = await getConversation(conversationId);
      const mods = parseAgentModifiers(conv?.agentModifiersJson ?? null);
      if (mods.derivedContext)
        setDerivedBanner({
          context: mods.derivedContext,
          label: mods.derivation?.actionLabel,
        });
      await touchConversation(conversationId);
      onActivity?.();
    } catch (e) {
      stopSpeech(); // 出错则停掉正在播放的朗读。
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: "对话衍生失败",
      });
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      derivationStartedRef.current = false;
      setRetry({ run: () => void startDerived(turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setDerivationPreparing(false);
        setStreaming("");
        setReplyBusy(false);
      } else {
        speaker?.abort(); // 本轮已被新动作取代,停止合成。
      }
    }
  }

  // opts.text:重试时复用原文(不从输入框取);opts.replacingId:换掉那条失败的旧轮次。
  async function send(opts?: { text?: string; replacingId?: string }) {
    const isRetry = opts?.text !== undefined;
    const text = (opts?.text ?? input).trim();
    if (!text || replyBusy) return;
    const draftAtSend = isDraft;
    stopSpeech();
    const priorTurns = opts?.replacingId
      ? turns.filter((t) => t.id !== opts.replacingId)
      : turns;
    const isFirstMessage = priorTurns.length === 0;
    const turnGen = ++turnGenRef.current;
    const turnId = crypto.randomUUID();
    liveTurnIdsRef.current.add(turnId);
    stickToBottomRef.current = true;
    if (!isRetry) setInput("");
    setError(null);
    setRetry(null);
    replyCommittedRef.current = false;
    setTurns((prev) => [
      ...(opts?.replacingId
        ? prev.filter((t) => t.id !== opts.replacingId)
        : prev),
      {
        id: turnId,
        userText: text,
        analysis: null,
        analysisPending: !learningMode,
      },
    ]);
    setReplyBusy(true);
    setStreaming("");
    let acc = "";
    // 自动朗读:回复完成后把整条回复作为一次 TTS 请求合成并播放。
    // 设置里关掉「自动朗读」时不创建朗读会话(小喇叭仍可手动朗读)。
    const speaker =
      !learningMode && loadTtsConfig().autoSpeak ? createReplySpeaker() : null;
    try {
      const result = await runTurn(
        text,
        conversationId,
        {
          onReplyDelta: (d) => {
            acc += d;
            setStreaming(acc);
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
        },
        turnId,
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
        speaker?.finish(result.reply);
      }
      if (draftAtSend) await onCreateDraftConversation?.(conversationId);
      // 轮次已持久化:更新会话排序,首条消息顺带自动命名,再刷新侧边栏。
      await touchConversation(conversationId);
      if ((isFirstMessage || draftAtSend) && !learningMode)
        await maybeAutoTitle(conversationId, text);
      onActivity?.();
    } catch (e) {
      stopSpeech(); // 出错则停掉正在播放的朗读。
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: learningMode ? "发送失败" : "发送失败,本轮未批改",
      });
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setRetry({ run: () => void send({ text, replacingId: turnId }) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setStreaming("");
        setReplyBusy(false);
      } else {
        speaker?.abort(); // 轮次已被新消息取代,停止本轮合成(播放已由新 send 的 stopSpeech 接管)。
      }
    }
  }

  // 从某条用户消息「从此处开始」:确认后舍弃这条(含)之后的所有 turn,把原文放回输入框
  // 供重新编辑。只删对话——已记入学习记忆(掌握/档案)的内容保留。
  async function editFromHere(turnId: string) {
    // 批改在途时截断会丢弃结果(observer 的 onAnalysis 写回已删除的 turn 变成空操作)。
    if (replyBusy || turns.some((t) => t.analysisPending)) return;
    const target = turns.find((t) => t.id === turnId);
    if (!target) return;
    const ok = await confirm({
      title: "从这条消息重新开始?",
      description:
        "这条及其之后的对话会被舍弃,消息内容会回到输入框供你修改。已记入学习记忆的内容不受影响。",
      confirmText: "舍弃并编辑",
      cancelText: "取消",
    });
    if (!ok) return;
    stopSpeech();
    turnGenRef.current++; // 让任何在途轮次的回调失效,别再写回被删的 turn
    await truncateConversationFrom(conversationId, turnId);
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turnId);
      return idx < 0 ? prev : prev.slice(0, idx);
    });
    setError(null);
    setRetry(null);
    setInput(target.userText);
    inputRef.current?.focus();
    await touchConversation(conversationId);
    onActivity?.();
  }

  // 重新生成最新一条回复:就地流式覆盖该轮气泡,失败则恢复原文。批改不变。
  async function regenerate(turnId: string) {
    if (replyBusy) return;
    stopSpeech();
    const turnGen = ++turnGenRef.current;
    const original = turns.find((t) => t.id === turnId)?.partnerText ?? "";
    stickToBottomRef.current = true;
    setError(null);
    setRetry(null);
    setReplyBusy(true);
    setRegeneratingId(turnId);
    let acc = "";
    try {
      await regenerateReply(conversationId, turnId, {
        onReplyDelta: (d) => {
          if (turnGenRef.current !== turnGen) return;
          acc += d;
          patchTurn(turnId, { partnerText: acc });
        },
        onReplyComplete: (reply) => {
          if (turnGenRef.current !== turnGen) return;
          patchTurn(turnId, { partnerText: reply });
        },
      });
      await touchConversation(conversationId);
      onActivity?.();
    } catch (e) {
      if (turnGenRef.current === turnGen)
        patchTurn(turnId, { partnerText: original });
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setRetry({ run: () => void regenerate(turnId) });
    } finally {
      if (turnGenRef.current === turnGen) {
        setReplyBusy(false);
        setRegeneratingId(null);
      }
    }
  }

  // 会话动作:先创建 pending 衍生会话并切换过去;新页面再生成上下文并自动开场。
  // 原会话不动(非破坏式),区别于 editFromHere(截断)。
  async function runConversationAction(
    actionId: string,
    sourceTurnId?: string,
  ) {
    if (actionBusy || replyBusy) return;
    setActionBusy(true);
    setError(null);
    setRetry(null);
    try {
      const result = await beginAction(actionId, {
        conversationId,
        sourceTurnId,
      });
      onActivity?.();
      if (result.navigateTo) onNavigateConversation?.(result.navigateTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }

  // 最新一条带回复的轮次——「重新生成」只挂在它上面。
  let lastReplyTurnId: string | undefined;
  for (const t of turns) if (t.partnerText) lastReplyTurnId = t.id;

  // 任一轮还在批改时,「从此处开始」会截断对话、丢弃在途批改结果——批改完成前一律禁用。
  const analyzing = turns.some((t) => t.analysisPending);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-6 pb-3"
        ref={messagesRef}
        onScroll={syncStickToBottom}
      >
        {derivedBanner && (
          <DerivedContextBanner
            conversationId={conversationId}
            context={derivedBanner.context}
            label={derivedBanner.label}
          />
        )}
        {turns.length === 0 && !streaming && (
          <div className="m-auto text-center text-sm leading-relaxed text-muted-foreground">
            {learningMode
              ? "正在准备专项课…"
              : "用目标语言说点什么,开始对话吧。"}
          </div>
        )}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`flex flex-col gap-2${
              liveTurnIdsRef.current.has(turn.id) ? " animate-message-in" : ""
            }`}
          >
            {turn.userText.trim() && (
              <UserTurn
                turn={turn}
                nativeLanguage={nativeLanguage}
                learningMode={learningMode}
                coachVisible={coachVisible}
                editDisabled={analyzing}
                onEditFrom={() => void editFromHere(turn.id)}
                onTurnAction={(actionId) =>
                  void runConversationAction(actionId, turn.id)
                }
              />
            )}
            {turn.partnerText && (
              <PartnerReply
                text={turn.partnerText}
                learningMode={learningMode}
                autoOpen={
                  !learningMode &&
                  autoBilingual &&
                  liveTurnIdsRef.current.has(turn.id)
                }
                onFirstExplain={() => void incrementExplainCount(turn.id)}
                onFirstBilingual={() => void incrementBilingualCount(turn.id)}
                onLayoutChange={requestLayoutScroll}
                onRegenerate={
                  !learningMode && turn.id === lastReplyTurnId
                    ? () => void regenerate(turn.id)
                    : undefined
                }
                regenerating={regeneratingId === turn.id}
              />
            )}
          </div>
        ))}
        {derivationPreparing && (
          <div className="m-auto flex flex-col items-center gap-2 text-center text-sm leading-relaxed text-muted-foreground">
            <Spinner />
            <span>正在生成新的对话上下文…</span>
          </div>
        )}
        {replyBusy && !streaming && !derivationPreparing && (
          <div className="self-stretch py-0.5">
            <TypingDots />
          </div>
        )}
        {streaming && (
          <div className="self-stretch py-0.5 text-foreground opacity-70">
            <Markdown>{streaming}</Markdown>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <TranslationPopover containerRef={messagesRef} />
      {error && (
        <div className="mx-4 flex items-center gap-3 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          {retry && !replyBusy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5"
              onClick={() => retry.run()}
            >
              <RefreshCwIcon size={14} />
              重试
            </Button>
          )}
        </div>
      )}
      <div className="shrink-0 px-4 pt-1.5 pb-4">
        <form
          className="flex items-end gap-1.5 rounded-lg border bg-card py-1.5 pr-1.5 pl-4 shadow transition-colors focus-within:border-ring"
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
            placeholder={
              learningMode
                ? "问老师、回答练习，母语/目标语言都可以…"
                : "用目标语言输入一句话…"
            }
            disabled={replyBusy}
            className="max-h-[calc(1.4em*3+0.9rem)] min-w-0 flex-1 resize-none border-none bg-transparent py-2 text-base leading-snug outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            className="size-9 transition-transform active:scale-90"
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
