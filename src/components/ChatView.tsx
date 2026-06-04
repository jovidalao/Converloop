import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchIcon,
  LanguagesIcon,
  MessageSquareReplyIcon,
  PencilIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReplySuggestionSource } from "../agents/reply-suggestion";
import type { TutorAnalysis } from "../agents/schema";
import {
  matchSlashCommands,
  parseSlashInput,
  type SlashCommand,
  slashMenuToken,
} from "../commands";
import { getContextLimit, useConfig } from "../config";
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
import { estimatePromptTokens } from "../lib/tokens";
import { deriveTurnActivities, type TurnActivity } from "../lib/turn-activity";
import {
  bilingualReply,
  MissingApiKeyError,
  regenerateReply,
  runTurn,
  startDerivedConversation,
  startLearningSession,
  suggestReply,
} from "../orchestrator";
import { beginAction, getActions, isAgentEnabled } from "../runtime";
import { loadTtsConfig } from "../tts/config";
import { stopSpeech } from "../tts/playback";
import { createReplySpeaker } from "../tts/stream";
import { useConfirm } from "./confirm";
import { InlineCorrection, UserSentence } from "./InlineCorrection";
import { Markdown } from "./Markdown";
import { ReplyExplanation } from "./ReplyExplanation";
import { SlashMenu } from "./SlashMenu";
import { SpeakButton } from "./SpeakButton";
import { TranslationPopover } from "./TranslationPopover";
import { ThinkingIndicator, TurnActivityRow } from "./TurnActivity";
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

interface ReplySuggestionControl {
  open: boolean;
  loading: boolean;
  text: string;
  error: string | null;
  warning: string | null;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}

function useReplySuggestion({
  conversationId,
  turnId,
  source,
  resetKey,
  onLayoutChange,
}: {
  conversationId: string;
  turnId: string;
  source: ReplySuggestionSource;
  resetKey: string;
  onLayoutChange?: () => void;
}): ReplySuggestionControl {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const previousResetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    requestIdRef.current++;
    setOpen(false);
    setLoading(false);
    setText("");
    setError(null);
    setWarning(null);
  }, [resetKey]);

  useEffect(() => {
    if (open || loading || text || error || warning) onLayoutChange?.();
  }, [open, loading, text, error, warning, onLayoutChange]);

  async function generate() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setWarning(null);
    setText("");
    let acc = "";
    try {
      const result = await suggestReply(conversationId, turnId, source, (d) => {
        if (requestIdRef.current !== requestId) return;
        acc += d;
        setText(acc);
      });
      if (requestIdRef.current === requestId) {
        setText(result.text);
        setWarning(
          result.finishReason?.kind === "length"
            ? `推荐回复因输出长度限制被截断(${result.finishReason.provider}:${result.finishReason.raw})。可以重试;反馈问题时请带上括号里的原因。`
            : null,
        );
      }
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }

  function toggle() {
    if (loading) return;
    if (!text && !error) {
      setOpen(true);
      void generate();
      return;
    }
    setOpen((v) => !v);
  }

  return {
    open,
    loading,
    text,
    error,
    warning,
    expanded: open && (loading || !!text || !!error),
    onToggle: toggle,
    onRetry: () => void generate(),
  };
}

function ReplySuggestionButton({
  suggestion,
}: {
  suggestion: ReplySuggestionControl;
}) {
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      data-active={suggestion.expanded}
      onClick={suggestion.onToggle}
      disabled={suggestion.loading}
      aria-expanded={suggestion.expanded}
      title="生成推荐回复"
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <MessageSquareReplyIcon className="size-4" />
      </span>
      <span>推荐回复</span>
    </Button>
  );
}

function ReplySuggestionPanel({
  suggestion,
  onUse,
}: {
  suggestion: ReplySuggestionControl;
  onUse?: (text: string) => void;
}) {
  if (
    !suggestion.open ||
    (!suggestion.loading && !suggestion.text && !suggestion.error)
  )
    return null;
  return (
    <div className="w-full animate-in rounded-lg border bg-card p-3 shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
      {suggestion.error ? (
        <div className="flex items-center gap-3">
          <span
            className="min-w-0 flex-1 text-sm leading-snug text-destructive"
            role="alert"
          >
            {suggestion.error}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5"
            disabled={suggestion.loading}
            onClick={suggestion.onRetry}
          >
            <RefreshCwIcon size={14} />
            重试
          </Button>
        </div>
      ) : suggestion.text ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            {suggestion.warning && (
              <p className="m-0 rounded-md bg-warning/10 px-2 py-1.5 text-xs leading-snug text-warning">
                {suggestion.warning}
              </p>
            )}
            <div
              className="text-sm leading-normal text-foreground"
              data-selectable-context
            >
              <Markdown>{suggestion.text}</Markdown>
            </div>
          </div>
          <Button
            type="button"
            variant="action"
            size="action"
            className="size-7 p-0"
            disabled={suggestion.loading}
            onClick={() => onUse?.(suggestion.text)}
            title="填入输入框"
            aria-label="填入输入框"
          >
            <PencilIcon size={14} />
          </Button>
        </div>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Spinner />
          正在生成推荐回复…
        </span>
      )}
    </div>
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
  conversationId,
  turnId,
  text,
  autoOpen = false,
  learningMode = false,
  offRecord = false,
  onFirstExplain,
  onFirstBilingual,
  onLayoutChange,
  onRegenerate,
  onUseSuggestion,
  regenerating = false,
}: {
  conversationId: string;
  turnId: string;
  text: string;
  autoOpen?: boolean;
  learningMode?: boolean;
  /** /btw 离档轮的回复:藏掉「推荐回复」(其依赖按 turnId 查上下文,离档轮已被排除会报错)。 */
  offRecord?: boolean;
  /** 用户首次主动点开讲解/双语时各触发一次(理解信号记账;自动展开不算)。 */
  onFirstExplain?: () => void;
  onFirstBilingual?: () => void;
  onLayoutChange?: () => void;
  /** 提供时显示「重新生成回复」按钮(仅挂在最新一条回复上)。 */
  onRegenerate?: () => void;
  onUseSuggestion?: (text: string) => void;
  regenerating?: boolean;
}) {
  const [open, setOpen] = useState(false); // 当前是否显示双语对照
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<string | null>(null); // 双语 Markdown
  const [error, setError] = useState<string | null>(null);
  const didAutoOpen = useRef(false);
  const prevTextRef = useRef(text);
  const replySuggestion = useReplySuggestion({
    conversationId,
    turnId,
    source: "partner_reply",
    resetKey: `${turnId}:${text}`,
    onLayoutChange,
  });

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
          {!offRecord && <ReplySuggestionButton suggestion={replySuggestion} />}
        </div>
        {!offRecord && (
          <ReplySuggestionPanel
            suggestion={replySuggestion}
            onUse={onUseSuggestion}
          />
        )}
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
        onLayoutChange={onLayoutChange}
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
            {!offRecord && (
              <ReplySuggestionButton suggestion={replySuggestion} />
            )}
          </>
        }
        extraPanels={
          offRecord ? null : (
            <ReplySuggestionPanel
              suggestion={replySuggestion}
              onUse={onUseSuggestion}
            />
          )
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
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {loading ? (
                <Spinner className="size-3.5 border-transparent border-t-current" />
              ) : (
                <LanguagesIcon className="size-4" />
              )}
            </span>
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
  suggestion,
  onEditFrom,
  onTurnAction,
  editDisabled = false,
}: {
  turn: ChatTurn;
  suggestion: ReplySuggestionControl;
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
      <ReplySuggestionButton suggestion={suggestion} />
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
  conversationId,
  nativeLanguage,
  learningMode,
  coachVisible,
  onEditFrom,
  onTurnAction,
  onLayoutChange,
  onUseSuggestion,
  editDisabled = false,
}: {
  turn: ChatTurn;
  conversationId: string;
  nativeLanguage: string;
  learningMode: boolean;
  coachVisible: boolean;
  onEditFrom: () => void;
  onTurnAction: (actionId: string) => void;
  onLayoutChange?: () => void;
  onUseSuggestion?: (text: string) => void;
  editDisabled?: boolean;
}) {
  const idiomatic = idiomaticText(turn.analysis);
  const [naturalOpen, setNaturalOpen] = useState(true);
  const replySuggestion = useReplySuggestion({
    conversationId,
    turnId: turn.id,
    source: "user_message",
    resetKey: `${turn.id}:${turn.userText}`,
    onLayoutChange,
  });
  // 离档轮(/btw):虚线气泡 + 「不计入上下文」标记;不批改、不显示改正/推荐/分支等操作。
  if (turn.excludeFromContext) {
    return (
      <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1 self-end">
        <div
          className="whitespace-pre-wrap rounded-2xl rounded-br-sm border border-dashed bg-secondary/50 px-3.5 py-2.5 text-base leading-normal text-foreground"
          data-selectable-context
        >
          {turn.userText}
        </div>
        <div className="-mr-1 flex items-center gap-1.5 pr-1">
          <span className="text-[11px] text-muted-foreground/70">
            顺便一问 · 不计入上下文
          </span>
          <CopyButton text={turn.userText} />
        </div>
      </div>
    );
  }
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
          <ReplySuggestionButton suggestion={replySuggestion} />
          <EditFromHereButton onClick={onEditFrom} disabled={editDisabled} />
        </div>
        <ReplySuggestionPanel
          suggestion={replySuggestion}
          onUse={onUseSuggestion}
        />
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
            suggestion={replySuggestion}
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
      <ReplySuggestionPanel
        suggestion={replySuggestion}
        onUse={onUseSuggestion}
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

// 一轮 = 用户输入 + 对话回复 + (默认折叠的)活动行。活动行把本轮的渐进披露收口到
// 一处:中间区保持轻,细节一键展开。教练面板打开时把细节交给右栏,这里只渲染对话本身。
function TurnCard({
  live,
  activities,
  children,
}: {
  live: boolean;
  activities: TurnActivity[];
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2${live ? " animate-message-in" : ""}`}>
      {children}
      {activities.length > 0 && <TurnActivityRow activities={activities} />}
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
  const config = useConfig();
  const { nativeLanguage, autoBilingual } = config;
  const confirm = useConfirm();
  const learningMode = mode === "learning_agent";

  // 输入框底部状态条:当前模型 + 上下文占用量(粗估,见 lib/tokens)。
  const contextLimit = getContextLimit(config);
  const usedTokens = useMemo(() => {
    const parts: string[] = [];
    for (const t of turns) {
      if (t.excludeFromContext) continue; // 离档轮(/btw)不进上下文,不计入占用量
      if (t.userText) parts.push(t.userText);
      if (t.partnerText) parts.push(t.partnerText);
    }
    if (streaming) parts.push(streaming);
    return estimatePromptTokens(parts);
  }, [turns, streaming]);
  const usedPercent = Math.min(
    100,
    Math.round((usedTokens / contextLimit) * 100),
  );

  // 对话栏斜杠命令(/btw 等):输入以 / 开头、命令词还在编辑时弹出菜单。键盘导航在 textarea
  // 拦截;Esc 关闭直到退出命令语境再重开。action 类命令仅在能衍生分支(practice 且非草稿)时出现。
  const [slashSelected, setSlashSelected] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashToken = useMemo(() => slashMenuToken(input), [input]);
  const canDerive = !learningMode && !isDraft;
  const slashCommands = useMemo(
    () =>
      slashToken !== null && !slashDismissed
        ? matchSlashCommands(slashToken, { canDerive })
        : [],
    [slashToken, slashDismissed, canDerive],
  );
  const slashOpen = slashCommands.length > 0;

  // 退出命令语境(无 token)时清掉「Esc 关闭」标记,下次再输入 / 即可重新弹出。
  useEffect(() => {
    if (slashToken === null && slashDismissed) setSlashDismissed(false);
  }, [slashToken, slashDismissed]);

  // 过滤结果变化后选中项可能越界——夹回 0。
  useEffect(() => {
    setSlashSelected((s) => (s < slashCommands.length ? s : 0));
  }, [slashCommands.length]);

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

  const useSuggestedReply = useCallback((text: string) => {
    const next = text.trim();
    if (!next) return;
    setInput(next);
    requestAnimationFrame(() => inputRef.current?.focus());
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

  // opts.text:重试时复用原文(不从输入框取);opts.replacingId:换掉那条失败的旧轮次;
  // opts.offRecord:/btw 离档轮——照常回复但不批改、不计入上下文(气泡带标记)。
  async function send(opts?: {
    text?: string;
    replacingId?: string;
    offRecord?: boolean;
  }) {
    const isRetry = opts?.text !== undefined;
    const text = (opts?.text ?? input).trim();
    if (!text || replyBusy) return;
    const offRecord = opts?.offRecord ?? false;
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
        analysisPending: !learningMode && !offRecord,
        excludeFromContext: offRecord,
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
        { offRecord },
      );
      if (turnGenRef.current === turnGen && !replyCommittedRef.current) {
        commitPartnerReply(turnId, result.reply);
        speaker?.finish(result.reply);
      }
      if (draftAtSend) await onCreateDraftConversation?.(conversationId);
      // 轮次已持久化:更新会话排序,首条消息顺带自动命名,再刷新侧边栏。
      // 离档轮(/btw)不定义会话主题,不参与自动命名。
      await touchConversation(conversationId);
      if ((isFirstMessage || draftAtSend) && !learningMode && !offRecord)
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
      setRetry({
        run: () => void send({ text, replacingId: turnId, offRecord }),
      });
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

  // 提交输入:先判斜杠命令。message 类(/btw)走离档发送;action 类执行现有会话动作;
  // meta(/help)展开完整命令清单;非命令照常发送。菜单已关闭时由 Enter / 发送键走到这里。
  function submitInput() {
    const parsed = parseSlashInput(input);
    if (!parsed) {
      void send();
      return;
    }
    if (parsed.command.kind === "message") {
      if (!parsed.rest) return; // 只敲了命令、没正文:不发送
      setInput("");
      void send({ text: parsed.rest, offRecord: true });
      return;
    }
    if (parsed.command.kind === "meta") {
      setInput("/"); // /help:展开完整命令清单
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (parsed.command.actionId) {
      setInput("");
      void runConversationAction(parsed.command.actionId);
    }
  }

  // 菜单里选中某命令(Enter / 点击):message 补成 "/btw " 进入正文输入;meta 展开全部;
  // action 立即执行(清空输入,菜单随之关闭)。
  function activateSlashCommand(command: SlashCommand) {
    if (command.kind === "action") {
      if (command.actionId) {
        setInput("");
        void runConversationAction(command.actionId);
      }
      return;
    }
    // message → "/name "(进入正文态);meta(/help)→ "/"(展开完整清单)。
    setInput(command.kind === "message" ? `/${command.name} ` : "/");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Tab 补全命令名:message 补成 "/btw "(进入正文态),其余补成 "/btw"(再 Enter 执行)。
  function completeSlashCommand(command: SlashCommand) {
    setInput(
      command.kind === "message" ? `/${command.name} ` : `/${command.name}`,
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // 最新一条带回复的轮次——「重新生成」只挂在它上面。
  let lastReplyTurnId: string | undefined;
  for (const t of turns) if (t.partnerText) lastReplyTurnId = t.id;

  // 任一轮还在批改时,「从此处开始」会截断对话、丢弃在途批改结果——批改完成前一律禁用。
  const analyzing = turns.some((t) => t.analysisPending);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div
        className="chat-scroll-mask flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-6 pb-3"
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
          <TurnCard
            key={turn.id}
            live={liveTurnIdsRef.current.has(turn.id)}
            activities={
              coachVisible
                ? []
                : deriveTurnActivities(turn).filter((a) => a.kind === "memory")
            }
          >
            {turn.userText.trim() && (
              <UserTurn
                turn={turn}
                conversationId={conversationId}
                nativeLanguage={nativeLanguage}
                learningMode={learningMode}
                coachVisible={coachVisible}
                onLayoutChange={requestLayoutScroll}
                editDisabled={analyzing}
                onEditFrom={() => void editFromHere(turn.id)}
                onTurnAction={(actionId) =>
                  void runConversationAction(actionId, turn.id)
                }
                onUseSuggestion={useSuggestedReply}
              />
            )}
            {turn.partnerText && (
              <PartnerReply
                conversationId={conversationId}
                turnId={turn.id}
                text={turn.partnerText}
                learningMode={learningMode}
                offRecord={turn.excludeFromContext}
                autoOpen={
                  !learningMode &&
                  autoBilingual &&
                  liveTurnIdsRef.current.has(turn.id)
                }
                onFirstExplain={() => void incrementExplainCount(turn.id)}
                onFirstBilingual={() => void incrementBilingualCount(turn.id)}
                onLayoutChange={requestLayoutScroll}
                onUseSuggestion={useSuggestedReply}
                onRegenerate={
                  !learningMode &&
                  !turn.excludeFromContext &&
                  turn.id === lastReplyTurnId
                    ? () => void regenerate(turn.id)
                    : undefined
                }
                regenerating={regeneratingId === turn.id}
              />
            )}
          </TurnCard>
        ))}
        {derivationPreparing && (
          <div className="m-auto flex flex-col items-center gap-2 text-center text-sm leading-relaxed text-muted-foreground">
            <Spinner />
            <span>正在生成新的对话上下文…</span>
          </div>
        )}
        {replyBusy && !derivationPreparing && streaming.trim().length < 2 && (
          <ThinkingIndicator className="self-stretch py-0.5" />
        )}
        {streaming.trim().length >= 2 && (
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
      <div className="shrink-0 px-4 pt-1.5 pb-1">
        <div className="relative">
          {slashOpen && (
            <SlashMenu
              commands={slashCommands}
              selected={slashSelected}
              onHover={setSlashSelected}
              onActivate={activateSlashCommand}
            />
          )}
          <form
            className="flex items-end gap-1.5 rounded-lg border bg-card py-1.5 pr-1.5 pl-4 shadow transition-colors focus-within:border-ring"
            onSubmit={(e) => {
              e.preventDefault();
              submitInput();
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // 菜单打开时拦截导航键(IME 合成中不拦截),不冒泡到发送。
                if (slashOpen && !e.nativeEvent.isComposing) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashSelected((s) => (s + 1) % slashCommands.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashSelected(
                      (s) =>
                        (s - 1 + slashCommands.length) % slashCommands.length,
                    );
                    return;
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const c = slashCommands[slashSelected];
                    if (c) completeSlashCommand(c);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const c = slashCommands[slashSelected];
                    if (c) activateSlashCommand(c);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSlashDismissed(true);
                    return;
                  }
                }
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  submitInput();
                }
              }}
              rows={1}
              placeholder={
                learningMode
                  ? "问老师、回答练习，母语/目标语言都可以…"
                  : "用目标语言输入一句话…（输入 / 查看命令）"
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
        <div
          className="mt-0.5 flex items-center justify-end gap-3 px-1 text-[11px] text-muted-foreground/70 tabular-nums"
          title={`约 ${usedTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens`}
        >
          <span className="min-w-0 truncate">{config.model}</span>
          <span className="shrink-0">上下文 {usedPercent}%</span>
        </div>
      </div>
    </div>
  );
}
