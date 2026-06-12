import { ArrowRightIcon, GraduationCapIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type TFunction, useTranslation } from "@/i18n";
import { onAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { splitHintParts } from "../agents/input-hints";
import {
  getReviewDueList,
  isIsolatedDrillKey,
  type ReviewItem,
} from "../db/mastery";
import {
  deriveSignals,
  type Signal,
  type SignalKind,
} from "../db/mastery-logic";
import {
  applyMemoryProposal,
  dismissMemoryProposal,
  listPendingMemoryProposalsForConversation,
  memoryProposalOperations,
} from "../db/memory-proposals";
import type { MemoryProposal, TurnAnnotation } from "../db/schema";
import { listTurnAnnotationsForConversation } from "../db/turn-annotations";
import type { ChatTurn } from "../db/turns";
import {
  generateInputHintsForConversation,
  loadCachedInputHints,
} from "../orchestrator";
import { Markdown } from "./Markdown";
import type { MainView } from "./Sidebar";
import { Button } from "./ui/button";

// Coach panel: a whole-conversation review surface. Per-turn corrections already
// live inline in the chat bubbles (see InlineCorrection), so the panel no longer
// duplicates them — it gathers what only makes sense across the session:
// progress stats, a turn-by-turn status index, the learning memory recorded from
// this conversation, custom-agent observations, and pending write proposals.
// Display only; it doesn't change the send/accounting logic.

const SIGNAL_TONE: Record<SignalKind, string> = {
  error: "bg-destructive/10 text-destructive",
  correct: "bg-success/10 text-success",
  introduced: "bg-muted text-ui-muted",
  gap: "bg-accent text-primary",
};

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-ui-body font-semibold text-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Learning-memory signal list (derived from corrections, same source as
// deriveSignals, no races).
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
            <span className="min-w-0 flex-1 truncate text-ui-meta font-medium text-foreground">
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

function CustomObservations({ items }: { items: TurnAnnotation[] }) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("coach.conversationObservationsEmpty")}
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

// Status badge for a single turn in the turn-by-turn review: a lightweight
// summary from the turn's analysis state.
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

// Turn-by-turn status index: a compact overview of how each sentence graded.
// Clicking a row scrolls the chat to that turn (the detailed correction lives
// inline in the bubble, not here).
function TurnReviewList({
  turns,
  onJumpToTurn,
}: {
  turns: ChatTurn[];
  onJumpToTurn?: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {turns.map((turn, i) => {
        const badge = turnStatusBadge(turn, t);
        return (
          <li key={turn.id}>
            <button
              type="button"
              onClick={() => onJumpToTurn?.(turn.id)}
              className="flex w-full min-w-0 items-center gap-2.5 rounded-lg bg-foreground-3 px-3 py-2 text-left transition-colors hover:bg-foreground-5"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground-5 text-ui-caption font-semibold tabular-nums text-foreground-80">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-ui-body text-foreground">
                {/* Prompt macros: show the verbatim command, not the expanded prompt fed to the agent. */}
                {(turn.displayText ?? turn.userText).trim() ||
                  t("coach.emptyTurnText")}
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

// "Due for review" — the same code-selected candidates fed to the conversation
// agent each turn (getReviewDueList). Surfacing them makes the passive-review
// loop visible: the learner can see what the AI was asked to weave back in.
function DueReviewList({ items }: { items: ReviewItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("coach.dueReview.empty")}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((item) => (
        <li
          key={item.key}
          className="flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2"
        >
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-background px-1.5 py-0.5 text-ui-caption font-medium text-ui-muted">
              {t(
                `coach.type.${item.type as "vocab" | "grammar" | "collocation" | "error_pattern" | "expression_gap"}`,
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-ui-meta font-medium text-foreground">
              {item.label}
            </span>
            <span className="shrink-0 rounded-full bg-info/10 px-1.5 py-0.5 text-ui-caption font-semibold text-info-text">
              {t("coach.dueReview.retention", {
                p: Math.round(item.retention * 100),
              })}
            </span>
          </div>
          {item.example?.trim() && (
            <p
              className="m-0 truncate text-ui-caption text-ui-muted"
              title={item.example}
            >
              {item.example.trim()}
            </p>
          )}
        </li>
      ))}
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

// "Ways to keep going": the single most-relevant coaching hint generated for the
// next reply (no rotation). Same content the chat input overlays — the panel just
// mirrors it. Display only. The hint is a native cue + a target-language opener
// joined by an arrow.
function ConversationHints({
  hints,
  regenerating,
  onUseHint,
}: {
  hints: string[];
  regenerating: boolean;
  onUseHint?: (text: string) => void;
}) {
  const { t } = useTranslation();
  if (hints.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {regenerating ? t("coach.hints.regenerating") : t("coach.hints.empty")}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {hints.map((hint, i) => {
        const { cue, opener } = splitHintParts(hint);
        return (
          <li
            key={`${i}:${hint}`}
            className="rounded-lg border bg-card text-ui-body"
          >
            <button
              type="button"
              className="flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
              onClick={() => onUseHint?.(opener)}
              title={t("coach.hints.use")}
            >
              {cue && (
                <span className="text-ui-caption font-medium text-ui-muted">
                  {cue}
                </span>
              )}
              <span className="leading-relaxed text-foreground">{opener}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CoachPanel({
  turns,
  conversationId,
  onOpenView,
  onJumpToTurn,
  onUseHint,
}: {
  turns: ChatTurn[];
  conversationId: string | null;
  onOpenView?: (view: MainView) => void;
  onJumpToTurn?: (turnId: string) => void;
  onUseHint?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [annotations, setAnnotations] = useState<TurnAnnotation[]>([]);
  const [convProposals, setConvProposals] = useState<MemoryProposal[]>([]);

  // Whole-conversation aggregate: deduplicate signals derived from corrections +
  // accurate/to-improve counts; pure in-memory, no DB. Isolated drill keys
  // (listening:/shadowing:) are skipped — they are not conversation "memory"
  // (shadowing records nothing at all), so showing them here would mislead.
  const conversationSignals = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const t of turns) {
      if (t.excludeFromContext || !t.analysis) continue;
      for (const s of deriveSignals(t.analysis)) {
        if (isIsolatedDrillKey(s.key)) continue;
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

  // Turns the learner actually produced. A derived conversation opens with a
  // partner-only turn (empty user input) so the partner can speak first; that's
  // not a learner turn and must not show as a phantom "(空)" row in the review.
  const learnerTurns = useMemo(
    () => turns.filter((t) => (t.displayText ?? t.userText).trim().length > 0),
    [turns],
  );

  // Due-for-review candidates: refetched when the conversation changes and when
  // a new turn's grading lands (accounting updates retention right after).
  const [dueItems, setDueItems] = useState<ReviewItem[]>([]);
  const gradedCount = useMemo(
    () => turns.filter((t) => !t.excludeFromContext && t.analysis).length,
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

  const refreshExtras = useCallback(() => {
    void Promise.all([
      conversationId
        ? listTurnAnnotationsForConversation(conversationId)
        : Promise.resolve([]),
      conversationId
        ? listPendingMemoryProposalsForConversation(conversationId)
        : Promise.resolve([]),
    ]).then(([nextAnnotations, nextConvProposals]) => {
      setAnnotations(nextAnnotations);
      setConvProposals(nextConvProposals);
    });
  }, [conversationId]);

  // Agent annotations/write proposals are committed to DB asynchronously; the
  // data layer emits coach-data-changed when a row lands, so the panel refetches
  // exactly once per write instead of polling on a timer.
  useEffect(() => {
    refreshExtras();
    if (!conversationId) return;
    return onAppEvent("coach-data-changed", () => refreshExtras());
  }, [conversationId, refreshExtras]);

  // The chat input generates coaching hints for the next reply and caches them
  // keyed by the last on-record turn. The panel mirrors that same cached set as a
  // block — it does not generate its own. Watermark = last turn counting toward
  // context (off-record /btw turns are excluded), matching ChatView.
  const hintWatermark = useMemo(
    () => [...turns].reverse().find((tn) => !tn.excludeFromContext)?.id ?? null,
    [turns],
  );
  const [hints, setHints] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const regeneratingRef = useRef(false);

  // Manual refresh: re-run hint generation for the current turn and re-cache it.
  // Used when the model returned nothing useful (e.g. a truncated response) and
  // the learner wants another set.
  const regenerateHints = useCallback(() => {
    if (!conversationId || regeneratingRef.current) return;
    regeneratingRef.current = true;
    setRegenerating(true);
    void generateInputHintsForConversation(conversationId)
      .then((h) => setHints(h))
      .finally(() => {
        regeneratingRef.current = false;
        setRegenerating(false);
      });
  }, [conversationId]);

  // Hints are written asynchronously after a reply arrives; the orchestrator
  // emits input-hints-changed when the cache updates, so reload then (plus one
  // initial read for the already-cached set).
  useEffect(() => {
    if (!conversationId || !hintWatermark) {
      setHints([]);
      return;
    }
    let cancelled = false;
    // Don't let a stale cache read overwrite a regeneration that's in flight.
    const load = () =>
      void loadCachedInputHints(conversationId, hintWatermark).then((h) => {
        if (!cancelled && !regeneratingRef.current) setHints(h);
      });
    load();
    const off = onAppEvent("input-hints-changed", (p) => {
      if (p.conversationId === conversationId) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [conversationId, hintWatermark]);

  const subtitle =
    learnerTurns.length === 0
      ? t("coach.waitingInput")
      : t("coach.wholeConversationSub", { n: learnerTurns.length });

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
      <div className="scrollbar-hover flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <p className="m-auto max-w-[34ch] text-center text-ui-body leading-relaxed text-foreground-80">
            {t("coach.emptyHint")}
          </p>
        ) : (
          <>
            <ConversationStats stats={stats} />
            <Section
              title={t("coach.hints.title")}
              action={
                <button
                  type="button"
                  onClick={regenerateHints}
                  disabled={regenerating}
                  title={t("coach.hints.regenerate")}
                  aria-label={t("coach.hints.regenerate")}
                  className="shrink-0 rounded p-1 text-ui-muted transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCwIcon
                    size={13}
                    className={regenerating ? "animate-spin" : undefined}
                  />
                </button>
              }
            >
              <ConversationHints
                hints={hints}
                regenerating={regenerating}
                onUseHint={onUseHint}
              />
            </Section>
            <Section title={t("coach.dueReview.title")}>
              <p className="m-0 -mt-1 text-ui-caption leading-snug text-ui-muted">
                {t("coach.dueReview.subtitle")}
              </p>
              <DueReviewList items={dueItems} />
            </Section>
            {learnerTurns.length > 0 && (
              <Section title={t("coach.reviewTitle")}>
                <TurnReviewList
                  turns={learnerTurns}
                  onJumpToTurn={onJumpToTurn}
                />
              </Section>
            )}
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
            <Section title={t("coach.observationsTitle")}>
              <CustomObservations items={annotations} />
            </Section>
            <Section title={t("coach.pendingMemoryTitle")}>
              <MemoryProposals
                items={convProposals}
                onChanged={refreshExtras}
              />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
