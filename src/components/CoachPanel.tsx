import {
  ArrowRightIcon,
  GraduationCapIcon,
  RefreshCwIcon,
  RepeatIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type TFunction, useTranslation } from "@/i18n";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { getReviewDueList, type ReviewItem } from "../db/mastery";
import {
  applyMemoryProposal,
  dismissMemoryProposal,
  listPendingMemoryProposalsForConversation,
  memoryProposalOperations,
} from "../db/memory-proposals";
import type { MemoryProposal } from "../db/schema";
import type { ChatTurn } from "../db/turns";
import { explainMasteryPoint, MissingApiKeyError } from "../orchestrator";
import {
  type CoachFocus,
  type CoachRecall,
  resolveCoachFocus,
} from "./coach-focus";
import { Markdown } from "./Markdown";
import type { MainView } from "./Sidebar";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Coach panel: a single adaptive "focus" on what matters right now in this
// conversation, refreshed every turn — not a static dashboard. Per-turn
// corrections live inline in the chat bubbles (InlineCorrection); whole-history
// data lives in the Mastery view. The panel surfaces the one most useful thing for
// the current moment, an optional active-recall nudge, an on-demand mini-lesson,
// and any pending memory write the learner can confirm.
//
// Layout is one flat surface: sections are separated by hairline dividers (no
// stacked/nested card boxes); the mini-lesson expands as a left-accented indent.

type KnownType =
  | "vocab"
  | "grammar"
  | "collocation"
  | "error_pattern"
  | "expression_gap";
const KNOWN_TYPES = new Set<string>([
  "vocab",
  "grammar",
  "collocation",
  "error_pattern",
  "expression_gap",
]);

function typeLabel(t: TFunction, type: string): string | null {
  return KNOWN_TYPES.has(type) ? t(`coach.type.${type as KnownType}`) : null;
}

// Small colored label that anchors each section semantically (the only "chrome";
// there are no card borders around sections).
function Kicker({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-ui-caption font-medium",
        tone,
      )}
    >
      {children}
    </span>
  );
}

// Point name + a muted type suffix (e.g. "plural nouns · grammar").
function PointName({ label, type }: { label: string; type: string | null }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 truncate text-ui-body font-medium text-foreground">
        {label}
      </span>
      {type && (
        <span className="shrink-0 text-ui-caption text-ui-muted">{type}</span>
      )}
    </div>
  );
}

// "original → corrected" one-liner used by the fix / recurring sections.
function DiffLine({
  original,
  corrected,
}: {
  original: string;
  corrected: string;
}) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-1.5 text-ui-body">
      <span className="text-ui-muted line-through">{original}</span>
      <ArrowRightIcon size={13} className="shrink-0 text-ui-subtle" />
      <span className="font-medium text-foreground">{corrected}</span>
    </p>
  );
}

// A lightweight text action (jump to the sentence / open inline detail).
function ActionLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-fit items-center gap-1 text-ui-caption font-medium text-foreground-80 transition-colors hover:text-foreground"
    >
      {label}
      <ArrowRightIcon size={12} />
    </button>
  );
}

// Interactive mini-lesson: one click streams a focused explanation of this point
// (rule + fresh examples, 举一反三) so the learner can generalize it — not just fix
// one sentence. Transient, not persisted. Expands inline as a left-accented indent
// (no nested card); `leading` shares the trigger row (e.g. a "view sentence" link).
function PointLesson({
  conversationId,
  label,
  type,
  evidence,
  leading,
  t,
}: {
  conversationId: string | null;
  label: string;
  type: string;
  evidence?: string;
  leading?: ReactNode;
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setLoading(true);
    setError(null);
    setText("");
    let acc = "";
    void explainMasteryPoint({ conversationId, label, type, evidence }, (d) => {
      acc += d;
      setText(acc);
    })
      .catch((e) =>
        setError(
          e instanceof MissingApiKeyError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e),
        ),
      )
      .finally(() => setLoading(false));
  }, [conversationId, label, type, evidence]);

  const toggle = () => {
    if (loading) return;
    if (!text && !error) {
      setOpen(true);
      generate();
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {leading}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex w-fit items-center gap-1 text-ui-caption font-medium text-primary transition-colors hover:opacity-80"
        >
          <WandSparklesIcon size={12} />
          {t("coach.lesson.explain")}
        </button>
      </div>
      {open && (
        <div className="border-l-2 pl-3">
          {loading && !text ? (
            <span className="inline-flex items-center gap-1.5 text-ui-caption text-ui-muted">
              <Spinner />
              {t("coach.lesson.loading")}
            </span>
          ) : error ? (
            <p className="m-0 text-ui-caption text-destructive">{error}</p>
          ) : (
            <>
              <Markdown className="text-ui-body leading-relaxed">
                {text}
              </Markdown>
              {!loading && (
                <button
                  type="button"
                  onClick={generate}
                  className="mt-2 inline-flex items-center gap-1 text-ui-caption text-ui-muted transition-colors hover:text-foreground"
                >
                  <RefreshCwIcon size={11} />
                  {t("coach.lesson.regenerate")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The single most-relevant thing about the conversation right now. Renders one of
// the priority-resolved focus kinds (see resolveCoachFocus) as flat content.
function FocusCard({
  focus,
  conversationId,
  t,
  onOpenDetail,
}: {
  focus: CoachFocus;
  conversationId: string | null;
  t: TFunction;
  onOpenDetail: (turnId: string, panel: "gap" | "grammar") => void;
}) {
  if (focus.kind === "empty" || focus.kind === "clean") {
    return (
      <p className="m-0 text-ui-body leading-relaxed text-foreground-80">
        {t(focus.kind === "empty" ? "coach.focus.empty" : "coach.focus.clean")}
      </p>
    );
  }

  if (focus.kind === "praise") {
    return (
      <div className="flex flex-col gap-2">
        <Kicker tone="bg-success/10 text-success">
          <SparklesIcon size={12} />
          {t("coach.focus.praiseKicker")}
        </Kicker>
        <p className="m-0 text-ui-body leading-relaxed text-foreground">
          {focus.highlight}
        </p>
      </div>
    );
  }

  if (focus.kind === "gap") {
    return (
      <div className="flex flex-col gap-2">
        <Kicker tone="bg-accent text-primary">
          {t("coach.focus.gapKicker")}
        </Kicker>
        <p className="m-0 text-ui-caption text-ui-muted">{focus.original}</p>
        <p className="m-0 text-ui-body font-medium leading-relaxed text-foreground">
          {focus.target}
        </p>
        {focus.template && (
          <p className="m-0 text-ui-caption text-ui-muted">
            {t("coach.focus.template", { template: focus.template })}
          </p>
        )}
        <ActionLink
          label={t("coach.focus.expand")}
          onClick={() => onOpenDetail(focus.turnId, "gap")}
        />
      </div>
    );
  }

  if (focus.kind === "recurring") {
    return (
      <div className="flex flex-col gap-2">
        <Kicker tone="bg-destructive/10 text-destructive">
          <RepeatIcon size={12} />
          {t("coach.focus.recurringKicker", { n: focus.count })}
        </Kicker>
        <PointName label={focus.label} type={typeLabel(t, focus.type)} />
        <DiffLine original={focus.original} corrected={focus.corrected} />
        <p className="m-0 text-ui-caption text-ui-muted">
          {t("coach.focus.recurringHint")}
        </p>
        <PointLesson
          key={focus.masteryKey}
          conversationId={conversationId}
          label={focus.label}
          type={focus.type}
          evidence={`${focus.original} → ${focus.corrected}`}
          t={t}
          leading={
            <ActionLink
              label={t("coach.focus.viewSentence")}
              onClick={() => onOpenDetail(focus.turnId, "grammar")}
            />
          }
        />
      </div>
    );
  }

  // fix
  return (
    <div className="flex flex-col gap-2">
      <Kicker tone="bg-info/10 text-info-text">
        {t("coach.focus.fixKicker")}
      </Kicker>
      <DiffLine original={focus.original} corrected={focus.corrected} />
      {focus.explanation && (
        <p className="m-0 line-clamp-2 text-ui-caption leading-snug text-ui-muted">
          {focus.explanation}
        </p>
      )}
      <PointLesson
        key={focus.masteryKey}
        conversationId={conversationId}
        label={focus.label}
        type={focus.type}
        evidence={`${focus.original} → ${focus.corrected}`}
        t={t}
        leading={
          <ActionLink
            label={t("coach.focus.viewSentence")}
            onClick={() => onOpenDetail(focus.turnId, "grammar")}
          />
        }
      />
    </div>
  );
}

// Active-recall nudge: turn one due-review item into a "try to use this next" call
// to action (distinct from the input-box opener hint).
function RecallTarget({
  recall,
  conversationId,
  t,
}: {
  recall: CoachRecall;
  conversationId: string | null;
  t: TFunction;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Kicker tone="bg-warning/10 text-warning">
        {t("coach.recall.kicker")}
      </Kicker>
      <PointName label={recall.label} type={typeLabel(t, recall.type)} />
      {recall.example?.trim() && (
        <p
          className="m-0 truncate text-ui-caption text-ui-muted"
          title={recall.example}
        >
          {recall.example.trim()}
        </p>
      )}
      <PointLesson
        key={recall.key}
        conversationId={conversationId}
        label={recall.label}
        type={recall.type}
        t={t}
      />
    </div>
  );
}

// Pending memory writes the learner can confirm — flat blocks, no card boxes.
function MemoryProposals({
  items,
  onChanged,
}: {
  items: MemoryProposal[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(id: string) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      const result = await applyMemoryProposal(id);
      setMessage(t("coach.applied", { n: result.applied }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      await dismissMemoryProposal(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const ops = memoryProposalOperations(item);
        return (
          <div key={item.id} className="flex flex-col gap-2 text-ui-body">
            <div className="font-medium">{item.summary}</div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-caption text-ui-muted">
              {ops.map((op, i) => (
                <li key={`${op.action}:${op.key}:${i}`}>
                  {t(`coach.proposal.${op.action}`, {
                    label: op.label ?? op.key,
                    target: op.target_key ?? "",
                  })}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-ui-caption"
                disabled={busyId === item.id}
                onClick={() => void apply(item.id)}
              >
                {t("coach.confirmWrite")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-ui-caption"
                disabled={busyId === item.id}
                onClick={() => void dismiss(item.id)}
              >
                {t("coach.dismiss")}
              </Button>
            </div>
          </div>
        );
      })}
      {message && <p className="m-0 text-ui-caption text-success">{message}</p>}
      {error && <p className="m-0 text-ui-caption text-destructive">{error}</p>}
    </div>
  );
}

function MasteryLink({
  onOpenView,
}: {
  onOpenView?: (view: MainView) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 self-start text-ui-caption text-foreground-80 transition-colors hover:text-foreground"
      onClick={() => onOpenView?.("mastery")}
    >
      {t("coach.viewAllData")}
      <ArrowRightIcon size={12} />
    </button>
  );
}

export function CoachPanel({
  turns,
  conversationId,
  onOpenView,
  onJumpToTurn,
}: {
  turns: ChatTurn[];
  conversationId: string | null;
  onOpenView?: (view: MainView) => void;
  onJumpToTurn?: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  const [convProposals, setConvProposals] = useState<MemoryProposal[]>([]);
  const [dueItems, setDueItems] = useState<ReviewItem[]>([]);

  // Refetch due-review candidates when the conversation changes and when a new
  // turn's grading lands (accounting updates retention right after).
  const gradedCount = useMemo(
    () => turns.filter((tn) => !tn.excludeFromContext && tn.analysis).length,
    [turns],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: conversationId/gradedCount are refetch triggers only; the effect reads the mastery table
  useEffect(() => {
    let cancelled = false;
    void getReviewDueList().then((items) => {
      if (!cancelled) setDueItems(items);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, gradedCount]);

  const { focus, recall } = useMemo(
    () => resolveCoachFocus(turns, dueItems),
    [turns, dueItems],
  );

  // Pending write proposals are committed to the DB asynchronously; the data layer
  // emits coach-data-changed when a row lands, so refetch once per write.
  const refreshProposals = useCallback(() => {
    void (
      conversationId
        ? listPendingMemoryProposalsForConversation(conversationId)
        : Promise.resolve([])
    ).then(setConvProposals);
  }, [conversationId]);
  useEffect(() => {
    refreshProposals();
    if (!conversationId) return;
    return onAppEvent("coach-data-changed", () => refreshProposals());
  }, [conversationId, refreshProposals]);

  // Focus card "expand / view this sentence": scroll to the turn and open its
  // in-bubble detail panel.
  const openDetail = useCallback(
    (turnId: string, panel: "gap" | "grammar") => {
      onJumpToTurn?.(turnId);
      emitAppEvent("panel-command", { panelId: `${turnId}:user:${panel}` });
    },
    [onJumpToTurn],
  );

  const subtitle =
    focus.kind === "empty" ? t("coach.waitingInput") : t("coach.subtitle");

  return (
    <div className="codex-coach-content group flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <GraduationCapIcon size={16} className="shrink-0 text-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-title font-semibold text-foreground">
              {t("coach.title")}
            </div>
            <div className="truncate text-ui-caption text-foreground-80">
              {subtitle}
            </div>
          </div>
        </div>
      </div>
      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        <section className="py-4">
          <FocusCard
            focus={focus}
            conversationId={conversationId}
            t={t}
            onOpenDetail={openDetail}
          />
        </section>
        {focus.kind !== "empty" && recall && (
          <section className="border-t py-4">
            <RecallTarget
              recall={recall}
              conversationId={conversationId}
              t={t}
            />
          </section>
        )}
        {convProposals.length > 0 && (
          <section className="flex flex-col gap-2.5 border-t py-4">
            <h3 className="m-0 text-ui-body font-semibold text-foreground">
              {t("coach.pendingMemoryTitle")}
            </h3>
            <MemoryProposals
              items={convProposals}
              onChanged={refreshProposals}
            />
          </section>
        )}
        <div className="border-t py-4">
          <MasteryLink onOpenView={onOpenView} />
        </div>
      </div>
    </div>
  );
}
