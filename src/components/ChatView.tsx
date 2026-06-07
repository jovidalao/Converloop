import anthropicLogo from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import claudeLogo from "@lobehub/icons-static-svg/icons/claude-color.svg?raw";
import cohereLogo from "@lobehub/icons-static-svg/icons/cohere-color.svg?raw";
import deepSeekLogo from "@lobehub/icons-static-svg/icons/deepseek-color.svg?raw";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini-color.svg?raw";
import grokLogo from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import groqLogo from "@lobehub/icons-static-svg/icons/groq.svg?raw";
import metaLogo from "@lobehub/icons-static-svg/icons/meta-color.svg?raw";
import mistralLogo from "@lobehub/icons-static-svg/icons/mistral-color.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import perplexityLogo from "@lobehub/icons-static-svg/icons/perplexity-color.svg?raw";
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import {
  ArrowUpIcon,
  CheckCircle2Icon,
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
import {
  activeProvider,
  findProviderModelOption,
  getContextLimit,
  PROVIDER_PRESETS,
  type ProviderType,
  providerModelLabel,
  saveConfig,
  useConfig,
  withActiveModel,
} from "../config";
import {
  getConversation,
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
import { staticT, useTranslation } from "../i18n";
import { estimatePromptTokens } from "../lib/tokens";
import { deriveTurnActivities, type TurnActivity } from "../lib/turn-activity";
import {
  bilingualReply,
  confirmLearningTurnMastery,
  generateAndSetConversationTitle,
  generateInputHintsForConversation,
  loadCachedInputHints,
  MissingApiKeyError,
  regenerateReply,
  runTurn,
  startDerivedConversation,
  startLearningSession,
  suggestReply,
} from "../orchestrator";
import {
  beginAction,
  getActions,
  isAgentEnabled,
  isAgentHidden,
} from "../runtime";
import { loadTtsConfig } from "../tts/config";
import { stopSpeech } from "../tts/playback";
import { createReplySpeaker } from "../tts/stream";
import { AnnotationIsland } from "./AnnotationIsland";
import { useConfirm } from "./confirm";
import { InlineCorrection, UserSentence } from "./InlineCorrection";
import { Markdown } from "./Markdown";
import { ReplyExplanation } from "./ReplyExplanation";
import { remarkBilingual } from "./remark-bilingual";
import { SlashMenu } from "./SlashMenu";
import { SpeakButton } from "./SpeakButton";
import { ThinkingIndicator, TurnActivityRow } from "./TurnActivity";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { Spinner } from "./ui/spinner";

interface ChatViewProps {
  conversationId: string;
  isDraft?: boolean;
  mode?: "practice" | "learning_agent";
  /** Fires after a new turn is persisted (title may have changed, sidebar needs refresh). */
  onActivity?: () => void;
  /** Called after the first turn of a draft conversation is persisted; creates the real conversation row. */
  onCreateDraftConversation?: (id: string) => Promise<void>;
  /** Reports all turns to the coach panel; re-reported when analysis arrives (read-only, doesn't affect this component's logic). */
  onTurnsChange?: (turns: ChatTurn[]) => void;
  /** Called when a conversation action creates a branch; App switches to the new conversation. */
  onNavigateConversation?: (id: string) => void;
  /** When the coach panel is visible, the in-chat per-turn "memory" activity row is hidden to avoid duplicating the panel's conversation-level learning-memory view; closing the panel brings the row back, so recorded memory stays visible either way. */
  coachVisible?: boolean;
  /** Small-window mode: strip to bare chat — message bubbles + copy + composer; hide explain/speak/suggestions/corrections/badges/slash menu. */
  compact?: boolean;
}

const MODEL_PROVIDERS = Object.keys(PROVIDER_PRESETS) as ProviderType[];
const CURRENT_MODEL_VALUE = "current";
const INPUT_TEXTAREA_MIN_HEIGHT = 56;
const INPUT_TEXTAREA_MAX_HEIGHT = 104;

interface ModelBrand {
  name: string;
  svg?: string;
  className?: string;
}

function modelBrand(model: string): ModelBrand {
  const lower = model.trim().toLowerCase();
  if (
    lower.includes("anthropic") ||
    lower.includes("claude") ||
    lower.includes("sonnet") ||
    lower.includes("haiku") ||
    lower.includes("opus")
  ) {
    return {
      name: lower.includes("anthropic") ? "Anthropic" : "Claude",
      svg: lower.includes("anthropic") ? anthropicLogo : claudeLogo,
      className: "text-info",
    };
  }
  if (lower.includes("gemini") || lower.includes("google")) {
    return {
      name: "Google Gemini",
      svg: geminiLogo,
      className: "text-brand",
    };
  }
  if (
    lower.includes("openai") ||
    lower.includes("gpt") ||
    lower.includes("chatgpt") ||
    /\bo[134]\b/.test(lower)
  ) {
    return {
      name: "OpenAI",
      svg: openAiLogo,
      className: "text-foreground",
    };
  }
  if (lower.includes("deepseek")) {
    return {
      name: "DeepSeek",
      svg: deepSeekLogo,
      className: "text-brand",
    };
  }
  if (lower.includes("qwen") || lower.includes("dashscope")) {
    return {
      name: "Qwen",
      svg: qwenLogo,
      className: "text-brand",
    };
  }
  if (lower.includes("llama") || lower.includes("meta")) {
    return {
      name: "Meta Llama",
      svg: metaLogo,
      className: "text-ui-secondary",
    };
  }
  if (lower.includes("mistral") || lower.includes("mixtral")) {
    return {
      name: "Mistral",
      svg: mistralLogo,
      className: "text-info",
    };
  }
  if (
    lower.includes("grok") ||
    lower.includes("xai") ||
    lower.includes("x-ai")
  ) {
    return {
      name: "xAI",
      svg: grokLogo,
      className: "text-foreground",
    };
  }
  if (lower.includes("groq")) {
    return {
      name: "Groq",
      svg: groqLogo,
      className: "text-destructive",
    };
  }
  if (lower.includes("perplexity") || lower.includes("pplx")) {
    return {
      name: "Perplexity",
      svg: perplexityLogo,
      className: "text-info",
    };
  }
  if (lower.includes("cohere") || lower.includes("command-r")) {
    return {
      name: "Cohere",
      svg: cohereLogo,
      className: "text-success",
    };
  }
  return {
    name: modelShortName(model),
    className: "text-ui-muted",
  };
}

function ModelLogo({
  model,
  compact = false,
}: {
  model: string;
  compact?: boolean;
}) {
  const brand = modelBrand(model);
  const sizeClass = compact ? "size-3 [&_svg]:size-3" : "size-4 [&_svg]:size-4";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${sizeClass} ${brand.className}`}
      title={brand.name}
      role="img"
      aria-label={brand.name}
    >
      {brand.svg ? (
        <span
          className="contents"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: vetted local SVG asset string
          dangerouslySetInnerHTML={{ __html: brand.svg }}
        />
      ) : (
        <SparklesIcon className="size-3.5" />
      )}
    </span>
  );
}

function modelShortName(model: string): string {
  const raw = model.trim();
  const lower = raw.toLowerCase();
  const claudeVersion = (family: string) => {
    const match = lower.match(
      new RegExp(`${family}[-_ ]?(\\d)(?:[-_.]?(\\d))?`),
    );
    if (!match) return "";
    return `${match[1]}${match[2] ? `.${match[2]}` : ""}`;
  };
  if (lower.includes("sonnet")) {
    const version = claudeVersion("sonnet");
    return version ? `Sonnet ${version}` : "Sonnet";
  }
  if (lower.includes("haiku")) {
    const version = claudeVersion("haiku");
    return version ? `Haiku ${version}` : "Haiku";
  }
  if (lower.includes("opus")) {
    const version = claudeVersion("opus");
    return version ? `Opus ${version}` : "Opus";
  }
  if (lower.includes("gpt-5.5")) return "GPT-5.5";
  if (lower.includes("gpt-5.4-mini")) return "GPT-5.4 mini";
  if (lower.includes("gpt-5.4-nano")) return "GPT-5.4 nano";
  if (lower.includes("gpt-5.4")) return "GPT-5.4";
  if (lower.includes("gpt-5.3-codex-spark")) return "GPT-5.3 Spark";
  if (lower.includes("gpt-4o-mini")) return "GPT-4o mini";
  if (lower.includes("gpt-4o")) return "GPT-4o";
  if (lower.includes("gemini")) {
    return raw
      .replace(/^gemini[-_ ]?/i, "Gemini ")
      .replace(/[-_ ]flash$/i, " Flash")
      .replace(/[-_]/g, " ");
  }
  return raw || staticT("chat.defaultModel");
}

function modelSelectValue(providerType: ProviderType, model: string): string {
  return `${providerType}::${model}`;
}

function parseModelSelectValue(
  value: string,
): { providerType: ProviderType; model: string } | null {
  const splitAt = value.indexOf("::");
  if (splitAt < 0) return null;
  const providerType = value.slice(0, splitAt) as ProviderType;
  if (!(providerType in PROVIDER_PRESETS)) return null;
  return { providerType, model: value.slice(splitAt + 2) };
}

// Copy the reply; briefly shows a checkmark after copying.
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      title={t("common.copy")}
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
  const { t } = useTranslation();
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
            ? t("chat.replySuggestionTruncated", {
                provider: result.finishReason.provider,
                raw: result.finishReason.raw,
              })
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
  const { t } = useTranslation();
  const { actionLabels } = useConfig();
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      data-active={suggestion.expanded}
      onClick={suggestion.onToggle}
      disabled={suggestion.loading}
      aria-expanded={suggestion.expanded}
      title={t("chat.generateReplySuggestion")}
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <MessageSquareReplyIcon className="size-4" />
      </span>
      {actionLabels && <span>{t("chat.replySuggestion")}</span>}
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
  const { t } = useTranslation();
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
            className="min-w-0 flex-1 text-ui-body leading-snug text-destructive"
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
            {t("common.retry")}
          </Button>
        </div>
      ) : suggestion.text ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            {suggestion.warning && (
              <p className="m-0 rounded-md bg-warning/10 px-2 py-1.5 text-ui-caption leading-snug text-warning">
                {suggestion.warning}
              </p>
            )}
            <div
              className="text-ui-body leading-normal text-foreground"
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
            title={t("chat.fillInput")}
            aria-label={t("chat.fillInput")}
          >
            <PencilIcon size={14} />
          </Button>
        </div>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-ui-body text-ui-muted">
          <Spinner />
          {t("chat.generatingReplySuggestion")}
        </span>
      )}
    </div>
  );
}

// "Edit from here": puts this user message back into the input for re-editing,
// discarding it and all following turns. Already-recorded learning memory is unaffected.
function EditFromHereButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      title={disabled ? t("chat.editFromHereGrading") : t("chat.editFromHere")}
      disabled={disabled}
      onClick={onClick}
    >
      <PencilIcon size={16} />
    </Button>
  );
}

function LessonMasteryButton({
  conversationId,
  turnId,
  disabled = false,
  onChanged,
}: {
  conversationId: string;
  turnId: string;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy || disabled) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await confirmLearningTurnMastery(conversationId, turnId);
      setMessage(
        result.applied > 0
          ? t("chat.masteryWritten", { n: result.applied })
          : result.summary,
      );
      onChanged?.();
    } catch (e) {
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="action"
        size="action"
        title={t("chat.recordMastery")}
        disabled={disabled || busy}
        onClick={() => void run()}
      >
        {busy ? <Spinner /> : <CheckCircle2Icon size={16} />}
      </Button>
      {message && (
        <span className="max-w-44 truncate text-ui-caption text-success">
          {message}
        </span>
      )}
      {error && (
        <span className="max-w-44 truncate text-ui-caption text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}

// One AI reply: bubble (original / bilingual toggle) + action row (copy / speak / explain / bilingual).
// Bilingual view is generated on demand and replaces the original; clicking again restores it.
// State is local to the component and not persisted.
// Key invariant: TTS always reads the original (target-language) text; SpeakButton always receives the raw text.
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
  /** /btw off-record reply: hide "Reply suggestion" (it looks up context by turnId; off-record turns are excluded and would error). */
  offRecord?: boolean;
  /** Fired once on the user's first manual open of explain/bilingual (signals comprehension difficulty; auto-open doesn't count). */
  onFirstExplain?: () => void;
  onFirstBilingual?: () => void;
  onLayoutChange?: () => void;
  /** When provided, shows the "Regenerate reply" button (only attached to the latest reply). */
  onRegenerate?: () => void;
  onUseSuggestion?: (text: string) => void;
  regenerating?: boolean;
}) {
  const { t } = useTranslation();
  const { actionLabels } = useConfig();
  const [open, setOpen] = useState(false); // whether bilingual view is currently shown
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<string | null>(null); // bilingual Markdown
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
  // When a transformer capability is "deleted" (hidden), its trigger button is also hidden.
  const bilingualHidden = isAgentHidden("builtin:transformer:bilingual");
  const suggestionHidden = isAgentHidden(
    "builtin:transformer:reply_suggestion",
  );

  // When a reply is replaced by "Regenerate", the old bilingual view no longer corresponds to it
  // — collapse and reset. Skip on first mount to avoid fighting with autoOpen.
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
      onFirstBilingual?.(); // user explicitly requested bilingual → comprehension-difficulty signal
      void generate();
      return;
    }
    setOpen((o) => !o);
  }

  // When "auto-open bilingual reading" is enabled in settings, a new reply expands and generates once on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when autoOpen flips, guarded by didAutoOpen ref; adding generate would re-fire every render
  useEffect(() => {
    if (autoOpen && !didAutoOpen.current && !bilingualHidden) {
      didAutoOpen.current = true;
      setOpen(true);
      void generate();
    }
  }, [autoOpen, bilingualHidden]);

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
          {!offRecord && !suggestionHidden && (
            <ReplySuggestionButton suggestion={replySuggestion} />
          )}
        </div>
        {!offRecord && !suggestionHidden && (
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
              className="min-w-0 flex-1 text-ui-body leading-snug text-destructive"
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
              {t("common.retry")}
            </Button>
          </div>
        ) : showBilingual && view ? (
          <Markdown
            className="bilingual"
            remarkPlugins={[remarkBilingual]}
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
                title={t("chat.regenerateReply")}
                onClick={onRegenerate}
                disabled={regenerating}
              >
                {regenerating ? <Spinner /> : <RefreshCwIcon size={16} />}
              </Button>
            )}
            {!offRecord && !suggestionHidden && (
              <ReplySuggestionButton suggestion={replySuggestion} />
            )}
          </>
        }
        extraPanels={
          offRecord || suggestionHidden ? null : (
            <ReplySuggestionPanel
              suggestion={replySuggestion}
              onUse={onUseSuggestion}
            />
          )
        }
        trailingActions={
          bilingualHidden ? null : (
            <Button
              type="button"
              variant="action"
              size="action"
              data-active={!!showBilingual}
              onClick={toggle}
              disabled={loading}
              aria-pressed={!!showBilingual}
              title={t("chat.bilingualTitle")}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center">
                {loading ? (
                  <Spinner className="size-3.5 border-transparent border-t-current" />
                ) : (
                  <LanguagesIcon className="size-4" />
                )}
              </span>
              {actionLabels && <span>{t("chat.bilingualReading")}</span>}
            </Button>
          )
        }
      />
    </div>
  );
}

// "More natural" rewrite: only for pure target-language turns; returned only when it exists
// and differs from the corrected sentence, otherwise null. Shown directly inside the user bubble.
function idiomaticText(analysis: TutorAnalysis | null): string | null {
  if (!analysis || analysis.expression_gap) return null;
  const natural = analysis.natural?.trim();
  if (!natural) return null;
  const corrected = analysis.corrected?.trim();
  return natural === corrected ? null : natural;
}

// User message actions: copy + speak. TTS prefers the "more natural" rewrite;
// falls back to the corrected sentence. Rendered as the leading slot in the
// correction action row, to the left of the toggle. Native/mixed turns
// (expression_gap) have no target-language sentence to read, so speak is hidden.
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
  // Registry-driven turn-level actions (e.g. "branch from here"); adding new actions requires no changes here.
  onTurnAction: (actionId: string) => void;
  // "Edit from here" is disabled while any turn is being graded — truncation would discard in-flight analysis.
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

// One user turn: bubble (original + optional "more natural" toggle) + action row / corrections.
// The "more natural" toggle state lives here and drives both the bubble content and the action row button.
function UserTurn({
  turn,
  conversationId,
  nativeLanguage,
  learningMode,
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
  onEditFrom: () => void;
  onTurnAction: (actionId: string) => void;
  onLayoutChange?: () => void;
  onUseSuggestion?: (text: string) => void;
  editDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const idiomatic = idiomaticText(turn.analysis);
  const [naturalOpen, setNaturalOpen] = useState(true);
  const replySuggestion = useReplySuggestion({
    conversationId,
    turnId: turn.id,
    source: "user_message",
    resetKey: `${turn.id}:${turn.userText}`,
    onLayoutChange,
  });
  // Off-record turn (/btw): dashed bubble + "not in context" label; no grading or correction/suggestion/branch actions.
  if (turn.excludeFromContext) {
    return (
      <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1 self-end">
        <div
          className="whitespace-pre-wrap rounded-2xl rounded-br-sm border border-dashed bg-secondary/50 px-3.5 py-2.5 text-ui-chat text-foreground"
          data-selectable-context
        >
          {turn.userText}
        </div>
        <div className="-mr-1 flex items-center gap-1.5 pr-1">
          <span className="text-ui-caption text-ui-subtle">
            {t("chat.btwLabel")}
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
          className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-ui-chat text-foreground shadow-sm"
          data-selectable-context
        >
          {turn.userText}
        </div>
        <div className="-mr-1 flex items-center gap-0.5">
          <CopyButton text={turn.userText} />
          <ReplySuggestionButton suggestion={replySuggestion} />
          <LessonMasteryButton
            conversationId={conversationId}
            turnId={turn.id}
            disabled={editDisabled}
            onChanged={onLayoutChange}
          />
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
      <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-ui-chat text-foreground shadow-sm">
        <UserSentence
          text={turn.userText}
          analysis={turn.analysis}
          nativeLanguage={nativeLanguage}
        />
        {idiomatic && naturalOpen && (
          <div className="mt-2 flex items-start gap-1.5 border-t pt-2 text-ui-body text-ui-muted">
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
          idiomatic
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

// Tracks which derived-conversation context panels have been seen; first visit expands, subsequent visits collapse.
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
      // Cap size to prevent unbounded growth.
      localStorage.setItem(
        DERIVED_BANNER_SEEN_KEY,
        JSON.stringify(list.slice(-200)),
      );
    }
  } catch {
    // localStorage unavailable — degrades gracefully to always-expanded.
  }
}

// Banner at the top of a derived conversation showing the context the Agent generated
// (scenario, roles, difficulty, continuity, etc.). Expanded on first visit, collapsed after.
// Lets the user understand where this conversation came from and what settings drove it.
function DerivedContextBanner({
  conversationId,
  context,
  label,
}: {
  conversationId: string;
  context: NewConversationContext;
  label?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !hasSeenDerivedBanner(conversationId));
  useEffect(() => {
    markDerivedBannerSeen(conversationId);
  }, [conversationId]);
  const rows: [string, string][] = [
    [t("chat.context.scenario"), context.scenario],
    [t("chat.context.userRole"), context.userRole],
    [t("chat.context.aiRole"), context.aiRole],
    [t("chat.context.difficulty"), context.difficulty],
    [t("chat.context.continuity"), context.continuitySummary],
    [t("chat.context.opening"), context.openingInstruction],
    [t("chat.context.constraints"), context.constraints.join(" / ")],
  ];
  return (
    <div className="rounded-lg border bg-muted/40 text-ui-body">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-muted transition-colors hover:text-foreground"
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
          {label ? `${label} · ` : ""}
          {t("chat.derivedContextLabel")}
        </span>
      </button>
      {open && (
        <dl className="space-y-2 border-t px-3 py-2.5 text-foreground">
          {rows
            .filter(([, value]) => value.trim())
            .map(([key, value]) => (
              <div key={key} className="flex gap-2.5">
                <dt className="w-14 shrink-0 text-ui-muted">{key}</dt>
                <dd className="min-w-0 flex-1 leading-snug">{value}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

// One turn = user input + partner reply + (collapsed by default) activity row.
// The activity row consolidates progressive disclosure for the turn: the center stays light,
// details expand on demand. When the coach panel is open, details go to the right panel; only the conversation is rendered here.
function TurnCard({
  turnId,
  live,
  activities,
  children,
}: {
  turnId: string;
  live: boolean;
  activities: TurnActivity[];
  children: ReactNode;
}) {
  return (
    <div
      data-turn-id={turnId}
      className={`flex flex-col gap-2${live ? " animate-message-in" : ""}`}
    >
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
  onTurnsChange,
  onNavigateConversation,
  coachVisible = false,
  compact = false,
}: ChatViewProps) {
  const { t } = useTranslation();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [layoutTick, setLayoutTick] = useState(0);
  const [replyBusy, setReplyBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [derivationPreparing, setDerivationPreparing] = useState(false);
  // Derived conversation context (shown in the collapsible header); null for regular conversations.
  const [derivedBanner, setDerivedBanner] = useState<{
    context: NewConversationContext;
    label?: string;
  } | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Retry entry for the last failed operation (send / regenerate / lesson start all share the bottom error bar).
  const [retry, setRetry] = useState<{ run: () => void } | null>(null);
  const [inputHints, setInputHints] = useState<string[] | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const turnGenRef = useRef(0);
  const replyCommittedRef = useRef(false);
  const kickoffStartedRef = useRef(false);
  const derivationStartedRef = useRef(false);
  const liveTurnIdsRef = useRef<Set<string>>(new Set()); // turns sent in this session; auto-bilingual only applies to these
  const hintTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const config = useConfig();
  const { nativeLanguage, autoBilingual, targetLanguage } = config;
  const confirm = useConfirm();
  const learningMode = mode === "learning_agent";
  // Coaching hints are rendered as an animated overlay (not the native placeholder, which can't
  // transition between hints). Active only in practice mode, when hints exist and the input is empty.
  const hintsActive =
    !compact &&
    !learningMode &&
    !!inputHints &&
    inputHints.length > 0 &&
    input.length === 0;

  // Status bar below the input: current model + context usage (rough estimate, see lib/tokens).
  const contextLimit = getContextLimit(config);
  const usedTokens = useMemo(() => {
    const parts: string[] = [];
    for (const turn of turns) {
      if (turn.excludeFromContext) continue; // off-record turns (/btw) are excluded from context and usage count
      if (turn.userText) parts.push(turn.userText);
      if (turn.partnerText) parts.push(turn.partnerText);
    }
    if (streaming) parts.push(streaming);
    return estimatePromptTokens(parts);
  }, [turns, streaming]);
  const usedPercent = Math.min(
    100,
    Math.round((usedTokens / contextLimit) * 100),
  );

  // Slash commands (/btw etc.): menu pops up when input starts with / and the command token is being edited.
  // Keyboard navigation is intercepted in the textarea; Esc closes until the command context is left and re-entered.
  // Action commands only appear when branching is possible (practice mode and not a draft).
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
  const slashOpen = !compact && slashCommands.length > 0;

  // When leaving the command context (no token), clear the "Esc-closed" flag so the next / re-opens the menu.
  useEffect(() => {
    if (slashToken === null && slashDismissed) setSlashDismissed(false);
  }, [slashToken, slashDismissed]);

  // When the filtered results change, the selected index may be out of bounds — clamp to 0.
  useEffect(() => {
    setSlashSelected((s) => (s < slashCommands.length ? s : 0));
  }, [slashCommands.length]);

  // Cycle placeholder hints every 5 s when available; clean up on unmount or when hints change.
  useEffect(() => {
    if (!inputHints || inputHints.length === 0) return;
    setHintIndex(0);
    hintTimerRef.current = setInterval(() => {
      setHintIndex((i) => (i + 1) % inputHints.length);
    }, 5000);
    return () => {
      if (hintTimerRef.current) clearInterval(hintTimerRef.current);
    };
  }, [inputHints]);

  // Input grows with content up to three lines; after that it scrolls internally.
  // biome-ignore lint/correctness/useExhaustiveDependencies: input is the intentional trigger; the effect reads inputRef after it changes, not input directly
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(el.scrollHeight, INPUT_TEXTAREA_MIN_HEIGHT),
      INPUT_TEXTAREA_MAX_HEIGHT,
    );
    el.style.height = `${nextHeight}px`;
    el.style.overflowY =
      el.scrollHeight > INPUT_TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
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
    setInputHints(null);
    if (hintTimerRef.current) clearInterval(hintTimerRef.current);
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
        // Restore input hints for the reopened conversation. The watermark is the last
        // on-record turn (off-record /btw turns are excluded from hint generation).
        const lastTurnId =
          [...loaded].reverse().find((tn) => !tn.excludeFromContext)?.id ??
          null;
        if (lastTurnId) {
          const capturedGen = turnGenRef.current;
          const cached = await loadCachedInputHints(conversationId, lastTurnId);
          if (cancelled || turnGenRef.current !== capturedGen) return;
          if (cached.length > 0) setInputHints(cached);
          else
            void generateInputHintsForConversation(conversationId).then(
              (hints) => {
                if (
                  !cancelled &&
                  turnGenRef.current === capturedGen &&
                  hints.length > 0
                )
                  setInputHints(hints);
              },
            );
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, learningMode]);

  // All turns are reported to the coach panel. Turns are patched (new object) when analysis arrives, so re-reporting is automatic.
  useEffect(() => {
    onTurnsChange?.(turns);
  }, [turns, onTurnsChange]);

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
        analysisError: t("chat.lessonStartFailed"),
      });
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      // Release the kickoff guard so retry can restart; the failed turn is replaced on retry.
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
    // Derived conversation opening also auto-speaks (same as regular send); not created when auto-speak is off.
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
      // Context has been written back to the conversation by the orchestrator; read it to light up the top banner.
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
      stopSpeech(); // stop any in-progress TTS on error
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: t("chat.derivationFailed"),
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
        speaker?.abort(); // this turn was superseded by a new action; stop synthesis
      }
    }
  }

  // opts.text: reuse original text on retry (don't pull from input box);
  // opts.replacingId: replace the failed old turn;
  // opts.offRecord: /btw off-record turn — replied to normally but not graded, not in context (bubble has a marker).
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
    // Reset hints for the new turn; hints generation fires after the reply arrives.
    setInputHints(null);
    if (hintTimerRef.current) clearInterval(hintTimerRef.current);
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
    // Auto-speak: synthesizes and plays the full reply as a single TTS request once streaming completes.
    // Not created when "auto-speak" is off in settings (the speaker icon can still be used manually).
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
      // Turn persisted: update conversation sort order, auto-name on first message, then refresh sidebar.
      // Off-record turns (/btw) don't define the conversation topic and are excluded from auto-naming.
      await touchConversation(conversationId);
      if ((isFirstMessage || draftAtSend) && !learningMode && !offRecord)
        void generateAndSetConversationTitle(conversationId, text).then(() =>
          onActivity?.(),
        );
      else onActivity?.();
      // Fire hint generation in the background after the reply is committed; silently ignore errors.
      if (!offRecord && !learningMode) {
        const capturedGen = turnGen;
        void generateInputHintsForConversation(conversationId).then((hints) => {
          if (turnGenRef.current === capturedGen && hints.length > 0)
            setInputHints(hints);
        });
      }
    } catch (e) {
      stopSpeech(); // stop any in-progress TTS on error
      speaker?.abort();
      patchTurn(turnId, {
        analysisPending: false,
        analysisError: learningMode
          ? t("chat.sendFailed")
          : t("chat.sendFailedNoGrading"),
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
        speaker?.abort(); // turn superseded by a new message; stop synthesis (playback already handed off to new send's stopSpeech)
      }
    }
  }

  // "Edit from here": after confirmation, discard this turn and all following turns,
  // and put the original text back into the input for re-editing.
  // Only the conversation is deleted — already-recorded learning memory (mastery/profile) is preserved.
  async function editFromHere(turnId: string) {
    // Truncating while grading is in flight would discard the result (observer's onAnalysis writing back to a deleted turn becomes a no-op).
    if (replyBusy || turns.some((turn) => turn.analysisPending)) return;
    const target = turns.find((turn) => turn.id === turnId);
    if (!target) return;
    const ok = await confirm({
      title: t("chat.editFromHereTitle"),
      description: t("chat.editFromHereDesc"),
      confirmText: t("chat.editFromHereConfirm"),
      cancelText: t("common.cancel"),
    });
    if (!ok) return;
    stopSpeech();
    turnGenRef.current++; // invalidate any in-flight turn callbacks; they must not write back to a deleted turn
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

  // Regenerate the latest reply: overwrite that turn's bubble in-place via streaming; restore original text on failure. Corrections remain unchanged.
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

  // Conversation action: creates a pending derived conversation and navigates to it;
  // the new page generates context and auto-starts. The original conversation is unchanged (non-destructive, unlike editFromHere which truncates).
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

  // Submit input: check for slash commands first. "message" type (/btw) sends off-record;
  // "action" type executes an existing conversation action; "meta" (/help) expands the full list;
  // non-commands send normally. Arrives here via Enter / Send when the menu is already closed.
  function submitInput() {
    const parsed = parseSlashInput(input);
    if (!parsed) {
      void send();
      return;
    }
    if (parsed.command.kind === "message") {
      if (!parsed.rest) return; // only the command was typed with no body text: don't send
      setInput("");
      void send({ text: parsed.rest, offRecord: true });
      return;
    }
    if (parsed.command.kind === "meta") {
      setInput("/"); // /help: expand the full command list
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (parsed.command.actionId) {
      setInput("");
      void runConversationAction(parsed.command.actionId);
    }
  }

  // Select a command in the menu (Enter / click): "message" completes to "/btw " for body input;
  // "meta" expands all; "action" executes immediately (clears input, menu closes as a result).
  function activateSlashCommand(command: SlashCommand) {
    if (command.kind === "action") {
      if (command.actionId) {
        setInput("");
        void runConversationAction(command.actionId);
      }
      return;
    }
    // message → "/name " (enter body mode); meta (/help) → "/" (expand full list)
    setInput(command.kind === "message" ? `/${command.name} ` : "/");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Tab-complete the command name: "message" completes to "/btw " (body mode); others to "/btw" (press Enter to run).
  function completeSlashCommand(command: SlashCommand) {
    setInput(
      command.kind === "message" ? `/${command.name} ` : `/${command.name}`,
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // The latest turn with a partner reply — "Regenerate" is only attached to it.
  let lastReplyTurnId: string | undefined;
  for (const turn of turns) if (turn.partnerText) lastReplyTurnId = turn.id;

  // "Edit from here" truncates the conversation and discards in-flight analysis — disabled until all grading completes.
  const analyzing = turns.some((turn) => turn.analysisPending);

  // Active option badges above the input area: shows at a glance the learning context for this turn (mode + derivation settings).
  const optionBadges: { label: string; tone: "info" | "muted" }[] = [
    learningMode
      ? { label: t("chat.lessonBadge"), tone: "info" }
      : { label: t("chat.practiceBadge"), tone: "muted" },
  ];
  if (derivedBanner) {
    optionBadges.push({
      label: derivedBanner.label ?? t("chat.derivedBadge"),
      tone: "info",
    });
    const diff = derivedBanner.context.difficulty?.trim();
    if (diff && diff.length <= 16)
      optionBadges.push({
        label: t("chat.difficultyBadge", { diff }),
        tone: "muted",
      });
  }
  const active = activeProvider(config);
  const currentPreset = PROVIDER_PRESETS[config.providerType];
  const currentModelOption = findProviderModelOption(
    config.providerType,
    active.model,
  );
  const usingPresetEndpoint = active.baseUrl.trim() === currentPreset.baseUrl;
  const currentProviderModelLabel = providerModelLabel(
    config.providerType,
    active.model,
  );
  const currentModelButtonLabel = modelShortName(active.model);
  const selectedModelValue =
    usingPresetEndpoint && currentModelOption
      ? modelSelectValue(config.providerType, currentModelOption.model)
      : CURRENT_MODEL_VALUE;
  const contextTitle = t("chat.contextUsage", {
    used: usedTokens.toLocaleString(),
    limit: contextLimit.toLocaleString(),
    pct: usedPercent,
  });

  function selectModelProvider(value: string) {
    if (value === CURRENT_MODEL_VALUE) return;
    const selected = parseModelSelectValue(value);
    if (!selected) return;
    saveConfig(withActiveModel(config, selected.providerType, selected.model));
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div
        className="chat-scroll-mask flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-3 pb-3"
        ref={messagesRef}
        onScroll={syncStickToBottom}
      >
        {!compact && derivedBanner && (
          <DerivedContextBanner
            conversationId={conversationId}
            context={derivedBanner.context}
            label={derivedBanner.label}
          />
        )}
        {turns.length === 0 && !streaming && (
          <div className="m-auto text-center text-ui-body leading-relaxed text-ui-muted">
            {learningMode
              ? t("chat.preparingLesson")
              : t("chat.startConversation")}
          </div>
        )}
        {turns.map((turn) => (
          <TurnCard
            key={turn.id}
            turnId={turn.id}
            live={liveTurnIdsRef.current.has(turn.id)}
            activities={
              compact || coachVisible
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
          <div className="m-auto flex flex-col items-center gap-2 text-center text-ui-body leading-relaxed text-ui-muted">
            <Spinner />
            <span>{t("chat.preparingContext")}</span>
          </div>
        )}
        {replyBusy && !derivationPreparing && streaming.trim().length < 2 && (
          <ThinkingIndicator className="self-stretch py-0.5" />
        )}
        {streaming.trim().length >= 2 && (
          <div className="self-stretch py-0.5 text-ui-secondary">
            <Markdown>{streaming}</Markdown>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <AnnotationIsland containerRef={messagesRef} />
      {error && (
        <div className="mx-4 flex items-center gap-3 rounded-md bg-destructive/15 px-3 py-2 text-ui-body text-destructive">
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
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      <div className="shrink-0 px-3 pb-3 pt-1.5">
        <div className="relative">
          {slashOpen && (
            <SlashMenu
              commands={slashCommands}
              selected={slashSelected}
              onHover={setSlashSelected}
              onActivate={activateSlashCommand}
            />
          )}
          <div className="overflow-hidden rounded-[var(--radius-panel)] border bg-card shadow-minimal transition-colors">
            <form
              className="flex flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                submitInput();
              }}
            >
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Intercept navigation keys when the menu is open (not during IME composition); don't let them bubble to send.
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
                            (s - 1 + slashCommands.length) %
                            slashCommands.length,
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
                      ? t("chat.inputPlaceholderLesson")
                      : !compact && inputHints && inputHints.length > 0
                        ? "" // hint shown via the animated overlay below
                        : t("chat.inputPlaceholderPractice", {
                            lang: targetLanguage || "your target language",
                          })
                  }
                  disabled={replyBusy}
                  className="max-h-[6.5rem] min-h-14 min-w-0 resize-none border-none bg-transparent px-4 pt-3 pb-2 text-ui-chat outline-none placeholder:text-muted-foreground"
                />
                {hintsActive && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden px-4 pt-3 text-ui-chat">
                    <span
                      key={hintIndex}
                      className="animate-hint-in block truncate text-muted-foreground"
                    >
                      {inputHints?.[hintIndex]}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex min-h-11 items-end gap-2 px-2 pt-1 pb-2">
                <div
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                  title={compact ? undefined : contextTitle}
                >
                  {!compact &&
                    optionBadges.map((b) => (
                      <span
                        key={b.label}
                        className={`inline-flex max-w-32 items-center truncate rounded-md px-1.5 py-0.5 text-ui-caption font-medium ${
                          b.tone === "info"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-ui-muted"
                        }`}
                      >
                        {b.label}
                      </span>
                    ))}
                </div>
                <Select
                  value={selectedModelValue}
                  onValueChange={selectModelProvider}
                  disabled={replyBusy}
                >
                  <SelectTrigger
                    className="h-4 w-auto min-w-[5.5rem] max-w-[min(42vw,12rem)] gap-1.5 rounded-sm border-0 bg-transparent px-1 py-0 font-normal leading-none text-ui-muted shadow-none hover:bg-accent focus-visible:ring-0 sm:max-w-[14rem] [&>svg]:size-2.5"
                    aria-label={t("chat.selectModel")}
                    title={currentProviderModelLabel}
                  >
                    <ModelLogo model={active.model} compact />
                    <span className="min-w-0 truncate text-ui-meta">
                      {currentModelButtonLabel}
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    side="top"
                    align="end"
                    sideOffset={6}
                    className="w-80 max-w-[min(92vw,24rem)]"
                  >
                    {selectedModelValue === CURRENT_MODEL_VALUE && (
                      <SelectItem value={CURRENT_MODEL_VALUE}>
                        <span className="flex min-w-0 items-center gap-2.5">
                          <ModelLogo model={active.model} />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">
                              {currentModelOption?.label ||
                                currentModelButtonLabel}
                            </span>
                            <span className="truncate text-ui-caption text-ui-muted">
                              {currentPreset.shortLabel} ·{" "}
                              {active.model.trim() || t("chat.emptyModelId")}
                            </span>
                          </span>
                        </span>
                      </SelectItem>
                    )}
                    {MODEL_PROVIDERS.map((providerType) => {
                      const preset = PROVIDER_PRESETS[providerType];
                      return preset.models.map((model) => (
                        <SelectItem
                          key={`${providerType}:${model.model}`}
                          value={modelSelectValue(providerType, model.model)}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <ModelLogo model={model.model} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate">{model.label}</span>
                              <span className="truncate text-ui-caption text-ui-muted">
                                {preset.shortLabel} · {model.model}
                              </span>
                            </span>
                          </span>
                        </SelectItem>
                      ));
                    })}
                  </SelectContent>
                </Select>
                <Button
                  type="submit"
                  size="icon"
                  className="size-8 rounded-full transition-transform active:scale-90"
                  disabled={replyBusy || !input.trim()}
                  title={t("chat.send")}
                  aria-label={t("chat.send")}
                >
                  {replyBusy ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <ArrowUpIcon className="size-4" />
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
