import {
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  GitBranchIcon,
  LanguagesIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import type { TutorAnalysis } from "../../agents/schema";
import { useConfig } from "../../config";
import type { NewConversationContext } from "../../db/conversations";
import type { ChatTurn } from "../../db/turns";
import { useTranslation } from "../../i18n";
import {
  applyLearningTurnMasteryPreview,
  bilingualReply,
  MissingApiKeyError,
  previewLearningTurnMastery,
} from "../../orchestrator";
import { getActions, isAgentEnabled, isAgentHidden } from "../../runtime";
import {
  hasCorrectedSentenceChange,
  InlineCorrection,
  UserSentence,
} from "../InlineCorrection";
import { Markdown } from "../Markdown";
import { ReplyExplanation } from "../ReplyExplanation";
import { remarkBilingual } from "../remark-bilingual";
import { SpeakButton } from "../SpeakButton";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  type ActivePanelId,
  ReplySuggestionButton,
  type ReplySuggestionControl,
  ReplySuggestionPanel,
  useReplySuggestion,
} from "./reply-suggestion";

// Copy the reply; briefly shows a checkmark after copying.
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      title={t("common.copy")}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            setCopied(false);
            timerRef.current = null;
          }, 1200);
        });
      }}
    >
      {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
    </Button>
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
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewLearningTurnMastery>
  > | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function previewRun() {
    if (busy || disabled) return;
    setBusy(true);
    setPreview(null);
    setMessage(null);
    setError(null);
    try {
      const result = await previewLearningTurnMastery(conversationId, turnId);
      setPreview(result);
      if (result.signals.length === 0) setMessage(result.summary);
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

  async function applyRun() {
    if (!preview || applying || disabled) return;
    setApplying(true);
    setMessage(null);
    setError(null);
    try {
      const result = await applyLearningTurnMasteryPreview(
        conversationId,
        turnId,
        preview,
      );
      setMessage(
        result.applied > 0
          ? t("chat.masteryWritten", { n: result.applied })
          : result.summary,
      );
      setPreview(null);
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
      setApplying(false);
    }
  }

  return (
    <span className="relative inline-flex items-center gap-1">
      <Button
        type="button"
        variant="action"
        size="action"
        title={t("chat.recordMastery")}
        disabled={disabled || busy}
        onClick={() => void previewRun()}
      >
        {busy ? <Spinner /> : <CheckCircle2Icon size={16} />}
      </Button>
      {preview && preview.signals.length > 0 && (
        <span className="absolute right-0 top-7 z-20 flex w-80 max-w-[80vw] flex-col gap-2 rounded-lg border bg-popover p-3 text-left shadow-lg">
          <span className="text-ui-body font-medium text-foreground">
            {t("chat.masteryPreviewTitle")}
          </span>
          <span className="text-ui-caption leading-snug text-ui-muted">
            {preview.summary}
          </span>
          <span className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {preview.signals.map((signal) => (
              <span
                key={signal.key}
                className="rounded-md bg-muted px-2 py-1.5 text-ui-caption leading-snug text-foreground"
              >
                <span className="font-medium">{signal.label}</span>
                <span className="ml-1 text-ui-muted">({signal.type})</span>
                <span className="mt-0.5 block truncate text-ui-muted">
                  {signal.example}
                </span>
              </span>
            ))}
          </span>
          <span className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              disabled={applying}
              onClick={() => setPreview(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={applying}
              onClick={() => void applyRun()}
            >
              {applying ? <Spinner /> : <CheckCircle2Icon size={14} />}
              {t("chat.masteryPreviewApply")}
            </Button>
          </span>
        </span>
      )}
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
// Generated bilingual/suggestion/explanation content is local; expanded state is coordinated by ChatView.
// Key invariant: TTS always reads the original (target-language) text; SpeakButton always receives the raw text.
type PartnerReplyProps = {
  conversationId: string;
  turnId: string;
  text: string;
  autoOpen?: boolean;
  // Rapid-fire / weak-spot-drill model answers are not part of a thread, so the "reply suggestion" (next-sentence)
  // action is hidden for both.
  variant?: "quickfire" | "review_drill";
  /** /btw off-record reply: hide "Reply suggestion" (it looks up context by turnId; off-record turns are excluded and would error). */
  offRecord?: boolean;
  /** Fired once on the user's first manual open of explain/bilingual (signals comprehension difficulty; auto-open doesn't count). */
  onFirstExplain?: () => void;
  onFirstBilingual?: () => void;
  onLayoutChange?: () => void;
  /** When provided, shows the "Regenerate reply" button (only attached to the latest reply). */
  onRegenerate?: () => void;
  regenerating?: boolean;
};

export const PartnerReply = memo(function PartnerReply({
  conversationId,
  turnId,
  text,
  autoOpen = false,
  variant,
  offRecord = false,
  onFirstExplain,
  onFirstBilingual,
  onLayoutChange,
  onRegenerate,
  regenerating = false,
}: PartnerReplyProps) {
  const { t } = useTranslation();
  const { actionLabels } = useConfig();
  // One open drop-below popup at a time within this reply (explanation / reply
  // suggestion). Bilingual reading replaces the bubble text in place rather than
  // dropping below, so it is independent and not part of this coordination.
  const [activePanelId, setActivePanelId] = useState<ActivePanelId>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<string | null>(null); // bilingual Markdown
  const [open, setOpen] = useState(false); // whether bilingual view is shown
  const [error, setError] = useState<string | null>(null);
  const didAutoOpen = useRef(false);
  const prevTextRef = useRef(text);
  const replySuggestion = useReplySuggestion({
    conversationId,
    turnId,
    source: "partner_reply",
    panelId: `${turnId}:partner:suggestion`,
    activePanelId,
    setActivePanelId,
    resetKey: `${turnId}:${text}`,
    onLayoutChange,
  });
  // When a transformer capability is "deleted" (hidden), its trigger button is also hidden.
  const bilingualHidden = isAgentHidden("builtin:transformer:bilingual");
  const suggestionHidden =
    isAgentHidden("builtin:transformer:reply_suggestion") ||
    variant === "quickfire" ||
    variant === "review_drill";

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
        panelId={`${turnId}:partner:explain`}
        activePanelId={activePanelId}
        setActivePanelId={setActivePanelId}
        conversationId={conversationId}
        turnId={turnId}
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
            <ReplySuggestionPanel suggestion={replySuggestion} />
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
              {actionLabels && (
                <span data-compact-label>{t("chat.bilingualReading")}</span>
              )}
            </Button>
          )
        }
      />
    </div>
  );
}, arePartnerReplyPropsEqual);

// "More natural" rewrite: only for pure target-language turns; returned only when it exists
// and differs from the corrected sentence, otherwise null. Shown directly inside the user bubble.
function idiomaticText(analysis: TutorAnalysis | null): string | null {
  if (!analysis || analysis.expression_gap) return null;
  const natural = analysis.natural?.trim();
  if (!natural) return null;
  const corrected = analysis.corrected?.trim();
  return natural === corrected ? null : natural;
}

export function hasLearningFeedback(turn: ChatTurn): boolean {
  const analysis = turn.analysis;
  if (!analysis) return false;
  if (analysis.expression_gap) return true;
  if (analysis.issues.length > 0) return true;
  const corrected = analysis.corrected?.trim();
  const natural = analysis.natural?.trim();
  const userText = turn.userText.trim();
  return (
    (!!corrected && corrected !== userText) ||
    (!!natural && natural !== userText)
  );
}

// User message actions: copy + speak. TTS prefers the "more natural" rewrite;
// falls back to the corrected sentence. Rendered as the leading slot in the
// correction action row, to the left of the toggle. Native/mixed turns
// (expression_gap) have no target-language sentence to read, so speak is hidden.
function UserMessageActions({
  turn,
  suggestion,
  onEditFrom,
  onRedo,
  onTurnAction,
  editDisabled = false,
  showReplySuggestion = true,
  showBranch = true,
}: {
  turn: ChatTurn;
  suggestion: ReplySuggestionControl;
  onEditFrom: () => void;
  /** "Say it again": invite the learner to re-produce the corrected meaning from memory as a fresh graded turn —
   *  the absorption step after a correction. Shown only when this turn actually got feedback. */
  onRedo?: () => void;
  // Registry-driven turn-level actions (e.g. "branch from here"); adding new actions requires no changes here.
  onTurnAction: (actionId: string) => void;
  // "Edit from here" is disabled while any turn is being graded — truncation would discard in-flight analysis.
  editDisabled?: boolean;
  // Drill modes hide actions that don't apply: dictation has no "reply suggestion" (you transcribe, not reply),
  // and neither dictation nor rapid-fire benefit from "branch from here" (deriving a conversation off a drill turn).
  showReplySuggestion?: boolean;
  showBranch?: boolean;
}) {
  const { t } = useTranslation();
  const analysis = turn.analysis;
  const corrected = analysis?.corrected?.trim() || turn.userText;
  const speakTarget = idiomaticText(analysis) ?? corrected;
  const canSpeak = !!analysis && !analysis.expression_gap;
  return (
    <>
      <CopyButton text={corrected} />
      {canSpeak && <SpeakButton text={speakTarget} />}
      {onRedo && hasLearningFeedback(turn) && (
        <Button
          type="button"
          variant="action"
          size="action"
          title={t("chat.redo")}
          aria-label={t("chat.redo")}
          onClick={onRedo}
        >
          <RotateCcwIcon size={16} />
        </Button>
      )}
      {showReplySuggestion && <ReplySuggestionButton suggestion={suggestion} />}
      <EditFromHereButton onClick={onEditFrom} disabled={editDisabled} />
      {showBranch &&
        getActions("turn")
          .filter((a) => isAgentEnabled(a.id))
          .map((a) => (
            <Button
              key={a.id}
              type="button"
              variant="action"
              size="action"
              title={`${a.label}:${a.description ?? ""}`}
              aria-label={a.label}
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
type UserTurnProps = {
  turn: ChatTurn;
  conversationId: string;
  nativeLanguage: string;
  learningMode: boolean;
  // Practice sub-mode driving which actions apply: dictation hides reply-suggestion / "more natural" / branch
  // (you transcribe a known sentence); quickfire hides only branch; review_drill hides branch AND reply-suggestion
  // (a generated suggestion IS the retrieval answer — one click would fake a clean correct signal on the target key).
  // undefined = ordinary practice (all actions).
  variant?: "quickfire" | "dictation" | "review_drill";
  onEditFrom: () => void;
  /** "Say it again" — see UserMessageActions. Undefined hides the action (lessons, sentence drills). */
  onRedo?: () => void;
  onTurnAction: (actionId: string) => void;
  onLayoutChange?: () => void;
  editDisabled?: boolean;
};

export const UserTurn = memo(function UserTurn({
  turn,
  conversationId,
  nativeLanguage,
  learningMode,
  variant,
  onEditFrom,
  onRedo,
  onTurnAction,
  onLayoutChange,
  editDisabled = false,
}: UserTurnProps) {
  const { t } = useTranslation();
  // One open drop-below popup at a time within this message (reply suggestion /
  // corrected sentence / expression-gap explanation / grammar details). The
  // "more natural" rewrite renders inside the bubble rather than dropping below,
  // so it is independent and not part of this coordination.
  const [activePanelId, setActivePanelId] = useState<ActivePanelId>(null);
  // Dictation transcribes a fixed target sentence: there is no "more natural" rendering of the learner's attempt.
  const idiomatic =
    variant === "dictation" ? null : idiomaticText(turn.analysis);
  const suggestionPanelId = `${turn.id}:user:suggestion`;
  const correctionPanelId = `${turn.id}:user:correction`;
  const gapPanelId = `${turn.id}:user:gap`;
  const grammarPanelId = `${turn.id}:user:grammar`;
  const correctedSentence = hasCorrectedSentenceChange(
    turn.userText,
    turn.analysis,
  )
    ? turn.analysis!.corrected.trim()
    : null;
  const replySuggestion = useReplySuggestion({
    conversationId,
    turnId: turn.id,
    source: "user_message",
    panelId: suggestionPanelId,
    activePanelId,
    setActivePanelId,
    resetKey: `${turn.id}:${turn.userText}`,
    onLayoutChange,
  });
  const correctionOpen = activePanelId === correctionPanelId;
  const [naturalOpen, setNaturalOpen] = useState(true);
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
  // Prompt-macro turn (/topic, /learn, /surprise): show the verbatim command (not the expanded prompt fed to the
  // agent), with no grading / "more natural" / reply-suggestion / branch actions — it's a directive, not learner output.
  if (turn.displayText) {
    return (
      <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1.5 self-end">
        <div
          className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-ui-chat text-foreground shadow-sm"
          data-selectable-context
        >
          {turn.displayText}
        </div>
        <div className="-mr-1 flex items-center gap-0.5">
          <CopyButton text={turn.displayText} />
          <EditFromHereButton onClick={onEditFrom} disabled={editDisabled} />
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
        <ReplySuggestionPanel suggestion={replySuggestion} />
      </div>
    );
  }
  return (
    <div className="flex max-w-[min(88%,520px)] flex-col items-end gap-1.5 self-end">
      <div
        className="whitespace-pre-wrap rounded-2xl rounded-br-sm border bg-secondary px-3.5 py-2.5 text-ui-chat text-foreground shadow-sm"
        data-selectable-context
      >
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
        diagnostic={turn.analysisDiagnostic}
        activePanelId={activePanelId}
        setActivePanelId={setActivePanelId}
        panelIds={{
          gap: gapPanelId,
          grammar: grammarPanelId,
        }}
        leading={
          <UserMessageActions
            turn={turn}
            suggestion={replySuggestion}
            onEditFrom={onEditFrom}
            onRedo={variant === "dictation" ? undefined : onRedo}
            onTurnAction={onTurnAction}
            editDisabled={editDisabled}
            showReplySuggestion={
              variant !== "dictation" && variant !== "review_drill"
            }
            showBranch={variant === undefined}
          />
        }
        correction={
          correctedSentence
            ? {
                text: correctedSentence,
                open: correctionOpen,
                onToggle: () =>
                  setActivePanelId((current) =>
                    current === correctionPanelId ? null : correctionPanelId,
                  ),
              }
            : undefined
        }
        natural={
          idiomatic
            ? {
                open: naturalOpen,
                onToggle: () => setNaturalOpen((v) => !v),
              }
            : undefined
        }
      />
      {variant !== "dictation" && variant !== "review_drill" && (
        <ReplySuggestionPanel suggestion={replySuggestion} />
      )}
    </div>
  );
}, areUserTurnPropsEqual);

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
export function DerivedContextBanner({
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
type TurnCardProps = {
  turnId: string;
  live: boolean;
  children: ReactNode;
};

export const TurnCard = memo(function TurnCard({
  turnId,
  live,
  children,
}: TurnCardProps) {
  return (
    <div
      data-turn-id={turnId}
      className={`flex flex-col gap-2${live ? " animate-message-in" : ""}`}
    >
      {children}
    </div>
  );
}, areTurnCardPropsEqual);

// NOTE: every prop added to PartnerReplyProps must be represented here (closure props at least by presence) —
// otherwise the memo silently freezes the new prop on existing turns.
function arePartnerReplyPropsEqual(
  prev: PartnerReplyProps,
  next: PartnerReplyProps,
) {
  return (
    prev.conversationId === next.conversationId &&
    prev.turnId === next.turnId &&
    prev.text === next.text &&
    prev.autoOpen === next.autoOpen &&
    prev.variant === next.variant &&
    prev.offRecord === next.offRecord &&
    prev.regenerating === next.regenerating &&
    Boolean(prev.onRegenerate) === Boolean(next.onRegenerate)
  );
}

// NOTE: every prop added to UserTurnProps must be represented here (closure props at least by presence) —
// otherwise the memo silently freezes the new prop on existing turns.
function areUserTurnPropsEqual(prev: UserTurnProps, next: UserTurnProps) {
  return (
    prev.turn === next.turn &&
    prev.conversationId === next.conversationId &&
    prev.nativeLanguage === next.nativeLanguage &&
    prev.learningMode === next.learningMode &&
    prev.variant === next.variant &&
    prev.editDisabled === next.editDisabled &&
    Boolean(prev.onRedo) === Boolean(next.onRedo)
  );
}

function areTurnCardPropsEqual(prev: TurnCardProps, next: TurnCardProps) {
  return (
    prev.turnId === next.turnId &&
    prev.live === next.live &&
    prev.children === next.children
  );
}
