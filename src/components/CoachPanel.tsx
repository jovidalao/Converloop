import { ArrowRightIcon, GraduationCapIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type TFunction, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
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
import { loadCachedInputHints } from "../orchestrator";
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

// "Ways to keep going": the whole set of coaching hints generated for the next
// reply, shown as a block. Same content the chat input cycles through one at a
// time — the panel just lays them all out. Display only. Each hint is a native
// cue + a target-language opener joined by an arrow.
function ConversationHints({ hints }: { hints: string[] }) {
  const { t } = useTranslation();
  if (hints.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">{t("coach.hints.empty")}</p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {hints.map((hint, i) => {
        const parts = hint.split("→");
        const cue = parts.length >= 2 ? parts[0].trim() : null;
        const opener = (
          parts.length >= 2 ? parts.slice(1).join("→") : hint
        ).trim();
        return (
          <li
            key={`${i}:${hint}`}
            className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 text-ui-body"
          >
            {cue && (
              <span className="text-ui-caption font-medium text-ui-muted">
                {cue}
              </span>
            )}
            <span className="leading-relaxed text-foreground">{opener}</span>
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
}: {
  turns: ChatTurn[];
  conversationId: string | null;
  onOpenView?: (view: MainView) => void;
  onJumpToTurn?: (turnId: string) => void;
}) {
  const { t } = useTranslation();
  const [annotations, setAnnotations] = useState<TurnAnnotation[]>([]);
  const [convProposals, setConvProposals] = useState<MemoryProposal[]>([]);

  const latestTurn = turns.length ? turns[turns.length - 1] : null;

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

  // Agent annotations/write proposals are committed to DB asynchronously. No
  // permanent polling: each new activity (new turn, grading arrival) opens a
  // short-lived polling window that stops automatically after a few seconds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: latestTurn id / analysisPending are change triggers only; grading arrival restarts the window
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
    latestTurn?.id,
    latestTurn?.analysisPending,
    refreshExtras,
  ]);

  // The chat input generates coaching hints for the next reply and caches them
  // keyed by the last on-record turn. The panel mirrors that same cached set as a
  // block — it does not generate its own. Watermark = last turn counting toward
  // context (off-record /btw turns are excluded), matching ChatView.
  const hintWatermark = useMemo(
    () => [...turns].reverse().find((tn) => !tn.excludeFromContext)?.id ?? null,
    [turns],
  );
  const [hints, setHints] = useState<string[]>([]);

  // Hints are written asynchronously after a reply arrives; reuse the same
  // short-lived polling window so they surface shortly after the turn.
  useEffect(() => {
    if (!conversationId || !hintWatermark) {
      setHints([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      void loadCachedInputHints(conversationId, hintWatermark).then((h) => {
        if (!cancelled) setHints(h);
      });
    load();
    let ticks = 0;
    const timer = window.setInterval(() => {
      load();
      ticks += 1;
      if (ticks >= 8) window.clearInterval(timer);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationId, hintWatermark]);

  const subtitle =
    turns.length === 0
      ? t("coach.waitingInput")
      : t("coach.wholeConversationSub", { n: turns.length });

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
            <Section title={t("coach.hints.title")}>
              <ConversationHints hints={hints} />
            </Section>
            <Section title={t("coach.reviewTitle")}>
              <TurnReviewList turns={turns} onJumpToTurn={onJumpToTurn} />
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
