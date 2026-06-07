import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  LanguagesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type TFunction, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { useConfig } from "../config";
import {
  deriveSignals,
  type Signal,
  type SignalKind,
} from "../db/mastery-logic";
import {
  applyMemoryProposal,
  dismissMemoryProposal,
  listPendingMemoryProposals,
  listPendingMemoryProposalsForConversation,
  memoryProposalOperations,
} from "../db/memory-proposals";
import type { MemoryProposal, TurnAnnotation } from "../db/schema";
import { listTurnAnnotations } from "../db/turn-annotations";
import type { ChatTurn } from "../db/turns";
import { deriveTurnActivities, type TurnActivity } from "../lib/turn-activity";
import { SEVERITY_COLOR } from "./InlineCorrection";
import { Markdown } from "./Markdown";
import type { MainView } from "./Sidebar";
import { SpeakableText } from "./SpeakButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Coach panel: gathers the corrections scattered across bubbles + what the
// system "recorded" into the right column, always visible. Display only; it
// doesn't change the send/accounting logic. Future visual polish: see
// docs/craft-ui-plan.md.

const SIGNAL_TONE: Record<SignalKind, string> = {
  error: "bg-destructive/10 text-destructive",
  correct: "bg-success/10 text-success",
  introduced: "bg-muted text-ui-muted",
  gap: "bg-accent text-primary",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="m-0 text-ui-body font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

type InspectorPanel = "feedback" | "memory" | "observations" | "proposals";

const STATUS_DOT: Record<TurnActivity["status"], string> = {
  pending: "bg-foreground-40",
  ok: "bg-success",
  info: "bg-foreground",
  error: "bg-destructive",
};

function CoachOverview({
  activities,
  active,
  memoryCount,
  annotationCount,
  proposalCount,
  onChange,
}: {
  activities: TurnActivity[];
  active: InspectorPanel;
  memoryCount: number;
  annotationCount: number;
  proposalCount: number;
  onChange: (panel: InspectorPanel) => void;
}) {
  const { t } = useTranslation();
  const feedback = activities.find((a) => a.kind === "tutor");
  const items: {
    id: InspectorPanel;
    label: string;
    value: string;
    status?: TurnActivity["status"];
  }[] = [
    {
      id: "feedback",
      label: t("coach.overview.feedback"),
      value: feedback?.label ?? t("coach.noFeedback"),
      status: feedback?.status,
    },
    {
      id: "memory",
      label: t("coach.overview.memory"),
      value:
        memoryCount > 0
          ? t("coach.memoryCount", { n: memoryCount })
          : t("coach.noMemoryThisTurn"),
      status: memoryCount > 0 ? "info" : undefined,
    },
    {
      id: "observations",
      label: t("coach.overview.observations"),
      value:
        annotationCount > 0
          ? t("coach.observationCount", { n: annotationCount })
          : t("coach.noObservations"),
      status: annotationCount > 0 ? "info" : undefined,
    },
    {
      id: "proposals",
      label: t("coach.overview.proposals"),
      value:
        proposalCount > 0
          ? t("coach.proposalCount", { n: proposalCount })
          : t("coach.noProposals"),
      status: proposalCount > 0 ? "info" : undefined,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={active === item.id}
          className={cn(
            "flex min-h-16 min-w-0 flex-col items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors",
            active === item.id
              ? "border-border bg-background shadow-minimal-flat"
              : "border-transparent bg-foreground-3 hover:bg-foreground-5",
          )}
          onClick={() => onChange(item.id)}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 text-ui-caption font-medium text-foreground-80">
            {item.status && (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  STATUS_DOT[item.status],
                )}
              />
            )}
            <span className="truncate">{item.label}</span>
          </span>
          <span className="mt-1 max-w-full truncate text-ui-body font-semibold text-foreground">
            {item.value}
          </span>
        </button>
      ))}
    </div>
  );
}

// Only shown while at least one activity is still pending — avoids duplicating
// information already visible in the CoachOverview tiles once grading is done.
function ActivitySummary({ activities }: { activities: TurnActivity[] }) {
  const pending = activities.filter((a) => a.status === "pending");
  if (pending.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {pending.map((activity, index) => (
        <div
          key={`${activity.kind}:${index}`}
          className="flex min-w-0 items-start gap-2 rounded-md bg-foreground-3 px-2.5 py-2"
          title={activity.preview}
        >
          <span
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full",
              STATUS_DOT[activity.status],
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui-body font-medium text-foreground">
              {activity.label}
            </span>
            {activity.preview && (
              <span className="mt-0.5 block truncate text-ui-caption text-foreground-80">
                {activity.preview}
              </span>
            )}
          </span>
          <Spinner className="mt-0.5 size-3.5 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// This turn's feedback: grading / plain-text fallback / expression gap /
// structured correction.
function TurnFeedback({
  turn,
  nativeLanguage,
}: {
  turn: ChatTurn;
  nativeLanguage: string;
}) {
  const { t } = useTranslation();
  const { analysis } = turn;

  if (turn.analysisPending && !analysis && !turn.analysisProse) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ui-body text-ui-muted">
        <Spinner />
        {t("coach.grading")}
      </span>
    );
  }

  if (!analysis && turn.analysisProse?.trim()) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words rounded-lg border bg-card p-3 font-sans text-ui-body leading-relaxed text-foreground">
        {turn.analysisProse.trim()}
      </pre>
    );
  }

  if (!analysis) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {turn.analysisError ?? t("coach.noCorrection")}
      </p>
    );
  }

  // Native-language / mixed turn: explain the construction approach, since there
  // is no target-language original to diff.
  const gap = analysis.expression_gap;
  if (gap) {
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 text-ui-body leading-normal shadow-sm">
        <FieldLabel icon={<LanguagesIcon size={12} />}>
          {t("coach.originalSentence", {
            lang: nativeLanguage.trim() || t("corrections.nativeFallback"),
          })}
        </FieldLabel>
        <p className="m-0 text-ui-muted">{gap.original}</p>
        <FieldLabel>{t("corrections.naturalExpression")}</FieldLabel>
        <SpeakableText text={gap.target_expression} />
        {gap.template?.trim() &&
          gap.template.trim() !== gap.target_expression.trim() && (
            <>
              <FieldLabel>{t("corrections.expressionTemplate")}</FieldLabel>
              <p className="m-0 font-mono text-ui-body text-foreground">
                {gap.template.trim()}
              </p>
            </>
          )}
        <FieldLabel>{t("corrections.explanationHeader")}</FieldLabel>
        <p className="m-0 leading-relaxed text-foreground">{gap.explanation}</p>
        {gap.key_items.length > 0 && (
          <>
            <FieldLabel>{t("corrections.keyItems")}</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {gap.key_items.map((it, i) => (
                <span
                  key={i}
                  className="inline-flex items-baseline gap-1.5 rounded-md border bg-background px-2 py-1"
                  title={it.gloss}
                >
                  <span className="font-semibold text-foreground">
                    {it.text}
                  </span>
                  <span className="text-ui-caption text-ui-muted">
                    {it.gloss}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
        {gap.usage_note?.trim() && (
          <p className="m-0 text-ui-body leading-snug text-ui-muted">
            {gap.usage_note.trim()}
          </p>
        )}
      </div>
    );
  }

  const hasIssues = analysis.issues.length > 0;
  const corrected = analysis.corrected?.trim();
  const natural = analysis.natural?.trim();
  const showCorrected = !!corrected && corrected !== turn.userText.trim();
  const showNatural = !!natural && natural !== corrected;

  if (!hasIssues && !showCorrected && !showNatural) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ui-body text-success">
        <CheckIcon size={15} />
        {t("coach.accurate")}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-ui-body leading-normal shadow-sm">
      {showCorrected && (
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("coach.corrected")}</FieldLabel>
          <SpeakableText text={corrected} />
        </div>
      )}
      {showNatural && (
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("coach.moreNatural")}</FieldLabel>
          <SpeakableText text={natural} />
        </div>
      )}
      {hasIssues && (
        <ul className="m-0 flex list-none flex-col p-0">
          {analysis.issues.map((iss, i) => (
            <li
              key={i}
              className="border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="rounded bg-accent px-1.5 py-0.5 text-ui-caption font-semibold uppercase tracking-wide text-primary">
                  {t(`corrections.category.${iss.category}`)}
                </span>
                <span
                  className={cn(
                    "text-ui-caption uppercase",
                    SEVERITY_COLOR[iss.severity],
                  )}
                >
                  {t(`corrections.severity.${iss.severity}`)}
                </span>
              </div>
              <p className="m-0">
                <del className="text-destructive line-through decoration-destructive">
                  {iss.span_original}
                </del>
                <span
                  className="mx-1.5 text-ui-caption text-ui-muted"
                  aria-hidden
                >
                  →
                </span>
                <ins className="font-medium text-success no-underline">
                  {iss.span_corrected}
                </ins>
              </p>
              <p className="mt-1.5 mb-0 text-ui-body leading-snug text-ui-muted">
                {iss.explanation}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldLabel({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-ui-caption font-semibold uppercase tracking-wide text-foreground-80">
      {icon}
      {children}
    </span>
  );
}

// Learning-memory signal list (derived from corrections, same source as
// deriveSignals, no races). Shared by the per-turn / whole-conversation views.
function SignalList({ signals }: { signals: Signal[] }) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {signals.map((s) => (
        <li
          key={`${s.kind}:${s.key}`}
          className="flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2"
        >
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-background px-1.5 py-0.5 text-ui-caption font-medium text-ui-muted">
              {t(`coach.type.${s.type}`)}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {s.label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-ui-caption font-semibold",
                SIGNAL_TONE[s.kind],
              )}
            >
              {t(`coach.signal.${s.kind}`)}
            </span>
          </div>
          {s.example?.trim() && (
            <p
              className="m-0 truncate text-ui-caption text-ui-muted"
              title={s.example}
            >
              {s.example.trim()}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// This turn's learning memory: the signals that code is about to record,
// derived from the correction. This is the core of "anything written to learning
// memory should be visible to the user" (acceptance #6).
function TurnMemory({ turn }: { turn: ChatTurn }) {
  const { t } = useTranslation();
  if (!turn.analysis) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("coach.memoryEmptyHint")}
      </p>
    );
  }
  const signals = deriveSignals(turn.analysis);
  if (signals.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">{t("coach.noNewMemory")}</p>
    );
  }
  return <SignalList signals={signals} />;
}

function CustomObservations({ items }: { items: TurnAnnotation[] }) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("coach.noCustomObservations")}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-lg border bg-card p-3 text-ui-body"
        >
          <div className="mb-1.5 font-semibold">{item.title}</div>
          <Markdown className="text-ui-body leading-relaxed">
            {item.bodyMd}
          </Markdown>
        </li>
      ))}
    </ul>
  );
}

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

  if (items.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("coach.noProposalsHint")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const ops = memoryProposalOperations(item);
        return (
          <div
            key={item.id}
            className="rounded-lg border bg-card p-3 text-ui-body"
          >
            <div className="font-semibold">{item.summary}</div>
            <ul className="my-2 flex list-none flex-col gap-1 p-0 text-ui-caption text-ui-muted">
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

type CoachScope = "conversation" | "turn";

// Status badge for a single turn in the turn-by-turn review: a lightweight
// summary from the same source as deriveTurnActivities.
function turnStatusBadge(
  turn: ChatTurn,
  t: TFunction,
): { label: string; tone: string } {
  if (turn.analysisPending) {
    return {
      label: t("coach.badge.grading"),
      tone: "bg-foreground-5 text-ui-muted",
    };
  }
  const a = turn.analysis;
  if (!a) {
    if (turn.analysisProse?.trim()) {
      return {
        label: t("coach.badge.graded"),
        tone: "bg-foreground-5 text-foreground-80",
      };
    }
    if (turn.analysisError) {
      return {
        label: t("coach.badge.failed"),
        tone: "bg-destructive/10 text-destructive",
      };
    }
    return {
      label: t("coach.badge.notGraded"),
      tone: "bg-foreground-5 text-ui-muted",
    };
  }
  if (a.expression_gap) {
    return { label: t("coach.badge.gap"), tone: "bg-accent text-primary" };
  }
  if (a.issues.length > 0) {
    return {
      label: t("coach.badge.issues", { n: a.issues.length }),
      tone: "bg-info/10 text-info-text",
    };
  }
  return {
    label: t("coach.badge.accurate"),
    tone: "bg-success/10 text-success",
  };
}

function ScopeSwitch({
  scope,
  onChange,
}: {
  scope: CoachScope;
  onChange: (scope: CoachScope) => void;
}) {
  const { t } = useTranslation();
  const tabs: { id: CoachScope; label: string }[] = [
    { id: "conversation", label: t("coach.scopeConversation") },
    { id: "turn", label: t("coach.scopeTurn") },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-card/70 p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={scope === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-md px-3 py-1 text-ui-caption font-medium transition-colors",
            scope === tab.id
              ? "bg-accent text-foreground"
              : "text-ui-muted hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function TurnNavigator({
  index,
  total,
  onChange,
}: {
  index: number;
  total: number;
  onChange: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-ui-muted hover:text-foreground"
        disabled={index <= 0}
        aria-label={t("coach.prevTurn")}
        onClick={() => onChange(index - 1)}
      >
        <ChevronLeftIcon size={16} />
      </Button>
      <span className="px-1 text-ui-caption tabular-nums text-foreground-80">
        {t("coach.turnCounter", { index: index + 1, total })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-ui-muted hover:text-foreground"
        disabled={index >= total - 1}
        aria-label={t("coach.nextTurn")}
        onClick={() => onChange(index + 1)}
      >
        <ChevronRightIcon size={16} />
      </Button>
    </div>
  );
}

function ConversationStats({
  stats,
}: {
  stats: { graded: number; accurate: number; issues: number; memory: number };
}) {
  const { t } = useTranslation();
  const cards: { label: string; value: number; tone?: string }[] = [
    { label: t("coach.stats.practiceTurns"), value: stats.graded },
    {
      label: t("coach.stats.accurate"),
      value: stats.accurate,
      tone: stats.accurate > 0 ? "text-success" : undefined,
    },
    {
      label: t("coach.stats.toImprove"),
      value: stats.issues,
      tone: stats.issues > 0 ? "text-info-text" : undefined,
    },
    {
      label: t("coach.stats.memory"),
      value: stats.memory,
      tone: stats.memory > 0 ? "text-primary" : undefined,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className="flex flex-col gap-0.5 rounded-lg bg-foreground-3 px-3 py-2.5"
        >
          <span className="text-ui-caption font-medium text-foreground-80">
            {c.label}
          </span>
          <span
            className={cn(
              "text-ui-title font-semibold tabular-nums text-foreground",
              c.tone,
            )}
          >
            {c.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// Turn-by-turn review: clicking any turn jumps to that turn's detail view.
function TurnReviewList({
  turns,
  activeTurnId,
  onSelect,
}: {
  turns: ChatTurn[];
  activeTurnId: string | null;
  onSelect: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {turns.map((turn, i) => {
        const badge = turnStatusBadge(turn, t);
        const active = turn.id === activeTurnId;
        return (
          <li key={turn.id}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(turn.id)}
              className={cn(
                "flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                active
                  ? "border-border bg-background shadow-minimal-flat"
                  : "border-transparent bg-foreground-3 hover:bg-foreground-5",
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground-5 text-ui-caption font-semibold tabular-nums text-foreground-80">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-ui-body text-foreground">
                {turn.userText.trim() || t("coach.emptyTurnText")}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-ui-caption font-semibold",
                  badge.tone,
                )}
              >
                {badge.label}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
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
      className="mt-1 inline-flex items-center gap-1 self-start text-ui-caption text-foreground transition-colors hover:bg-accent"
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
}: {
  turns: ChatTurn[];
  conversationId: string | null;
  onOpenView?: (view: MainView) => void;
}) {
  const { t } = useTranslation();
  const { nativeLanguage } = useConfig();
  const [scope, setScope] = useState<CoachScope>("turn");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<InspectorPanel>("feedback");
  const [annotations, setAnnotations] = useState<TurnAnnotation[]>([]);
  const [turnProposals, setTurnProposals] = useState<MemoryProposal[]>([]);
  const [convProposals, setConvProposals] = useState<MemoryProposal[]>([]);

  const latestTurnId = turns.length ? turns[turns.length - 1].id : null;
  const activeTurn = useMemo(
    () => turns.find((t) => t.id === activeTurnId) ?? null,
    [turns, activeTurnId],
  );
  const activeIndex = turns.findIndex((t) => t.id === activeTurn?.id);

  // When a new turn arrives (or on initial conversation load), auto-advance to
  // the latest turn and reset to the feedback panel.
  useEffect(() => {
    setActiveTurnId(latestTurnId);
    setActivePanel("feedback");
  }, [latestTurnId]);

  // When the conversation changes, return to the turn-scope view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: conversationId is only a change trigger; the effect doesn't read it
  useEffect(() => {
    setScope("turn");
  }, [conversationId]);

  // Whole-conversation aggregate: deduplicate signals derived from corrections +
  // accurate/to-improve counts; pure in-memory, no DB.
  const conversationSignals = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const t of turns) {
      if (t.excludeFromContext || !t.analysis) continue;
      for (const s of deriveSignals(t.analysis)) {
        if (!map.has(s.key)) map.set(s.key, s);
      }
    }
    return [...map.values()];
  }, [turns]);

  const stats = useMemo(() => {
    let graded = 0;
    let accurate = 0;
    let issues = 0;
    for (const t of turns) {
      if (t.excludeFromContext || !t.analysis) continue;
      graded += 1;
      const a = t.analysis;
      issues += a.issues.length;
      const corrected = a.corrected?.trim();
      const natural = a.natural?.trim();
      const showCorrected = !!corrected && corrected !== t.userText.trim();
      const showNatural = !!natural && natural !== corrected;
      if (
        a.issues.length === 0 &&
        !showCorrected &&
        !showNatural &&
        !a.expression_gap
      ) {
        accurate += 1;
      }
    }
    return { graded, accurate, issues, memory: conversationSignals.length };
  }, [turns, conversationSignals]);

  const activities = useMemo(
    () => (activeTurn ? deriveTurnActivities(activeTurn) : []),
    [activeTurn],
  );
  const memoryCount = useMemo(
    () =>
      activeTurn?.analysis ? deriveSignals(activeTurn.analysis).length : 0,
    [activeTurn],
  );

  const selectTurn = useCallback((turnId: string) => {
    setActiveTurnId(turnId);
    setActivePanel("feedback");
    setScope("turn");
  }, []);

  const refreshExtras = useCallback(() => {
    void Promise.all([
      activeTurnId ? listTurnAnnotations(activeTurnId) : Promise.resolve([]),
      activeTurnId
        ? listPendingMemoryProposals(activeTurnId)
        : Promise.resolve([]),
      conversationId
        ? listPendingMemoryProposalsForConversation(conversationId)
        : Promise.resolve([]),
    ]).then(([nextAnnotations, nextTurnProposals, nextConvProposals]) => {
      setAnnotations(nextAnnotations);
      setTurnProposals(nextTurnProposals);
      setConvProposals(nextConvProposals);
    });
  }, [activeTurnId, conversationId]);

  // Agent annotations/write proposals are committed to DB asynchronously. No
  // permanent polling: each new activity (turn switch, new turn, grading arrival)
  // opens a short-lived polling window that stops automatically after a few seconds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: latestTurnId / analysisPending are change triggers only; grading arrival restarts the window
  useEffect(() => {
    refreshExtras();
    if (!conversationId) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      refreshExtras();
      ticks += 1;
      if (ticks >= 8) window.clearInterval(timer);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [
    conversationId,
    latestTurnId,
    activeTurn?.analysisPending,
    refreshExtras,
  ]);

  const subtitle =
    turns.length === 0
      ? t("coach.waitingInput")
      : scope === "conversation"
        ? t("coach.wholeConversationSub", { n: turns.length })
        : activeIndex >= 0
          ? t("coach.turnCounter", {
              index: activeIndex + 1,
              total: turns.length,
            })
          : t("coach.currentTurn");

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
        {turns.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ScopeSwitch scope={scope} onChange={setScope} />
            {scope === "turn" && activeIndex >= 0 && (
              <TurnNavigator
                index={activeIndex}
                total={turns.length}
                onChange={(i) => selectTurn(turns[i].id)}
              />
            )}
          </div>
        )}
      </div>
      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <p className="m-auto max-w-[34ch] text-center text-ui-body leading-relaxed text-foreground-80">
            {t("coach.emptyHint")}
          </p>
        ) : scope === "conversation" ? (
          <>
            <ConversationStats stats={stats} />
            <Section title={t("coach.reviewTitle")}>
              <TurnReviewList
                turns={turns}
                activeTurnId={activeTurnId}
                onSelect={selectTurn}
              />
            </Section>
            <Section title={t("coach.conversationMemoryTitle")}>
              {conversationSignals.length > 0 ? (
                <SignalList signals={conversationSignals} />
              ) : (
                <p className="m-0 text-ui-body text-ui-muted">
                  {t("coach.conversationMemoryEmpty")}
                </p>
              )}
              <MasteryLink onOpenView={onOpenView} />
            </Section>
            <Section title={t("coach.pendingMemoryTitle")}>
              <MemoryProposals
                items={convProposals}
                onChanged={refreshExtras}
              />
            </Section>
          </>
        ) : activeTurn ? (
          <>
            <CoachOverview
              activities={activities}
              active={activePanel}
              memoryCount={memoryCount}
              annotationCount={annotations.length}
              proposalCount={turnProposals.length}
              onChange={setActivePanel}
            />
            <ActivitySummary activities={activities} />
            {activePanel === "feedback" && (
              <Section title={t("coach.feedbackTitle")}>
                <TurnFeedback
                  turn={activeTurn}
                  nativeLanguage={nativeLanguage}
                />
              </Section>
            )}
            {activePanel === "memory" && (
              <Section title={t("coach.turnMemoryTitle")}>
                <TurnMemory turn={activeTurn} />
                <MasteryLink onOpenView={onOpenView} />
              </Section>
            )}
            {activePanel === "observations" && (
              <Section title={t("coach.observationsTitle")}>
                <CustomObservations items={annotations} />
              </Section>
            )}
            {activePanel === "proposals" && (
              <Section title={t("coach.pendingMemoryTitle")}>
                <MemoryProposals
                  items={turnProposals}
                  onChanged={refreshExtras}
                />
              </Section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
