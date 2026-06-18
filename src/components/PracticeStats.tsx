import { CheckIcon, FlameIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { useConfig } from "@/config";
import { type Locale, type TFunction, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getLearningStats,
  type LearningStats,
  localDayNumber,
} from "../db/learning-stats";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Practice-stats card on the new-chat start page (slotted between the header and the topic chips). A single integrated
// surface — a streak header plus a row of three square tiles (today's goal ring, a recent-trend sparkline, and a
// GitHub-style activity calendar) — that both records progress and motivates the next session (Duolingo daily-goal + streak
// mechanics, kept calm). Read-only; drills are launched from the sidebar, the command palette, or the Practice Center.

const HEATMAP_WEEKS = 6;
const TREND_DAYS = 14;
const DAY_MS = 86_400_000;

// dayNumber → UTC-midnight Date (localDayNumber is built from Date.UTC, so the
// inverse reads back with the UTC accessors / a UTC-pinned formatter).
function dayDate(day: number): Date {
  return new Date(day * DAY_MS);
}

// SVG fill class per day's sentence count (rects, so fill-* rather than bg-*).
function heatFill(count: number): string {
  if (count <= 0) return "fill-foreground-5";
  if (count <= 2) return "fill-primary/25";
  if (count <= 5) return "fill-primary/50";
  if (count <= 9) return "fill-primary/75";
  return "fill-primary";
}

// Square tile wrapper for the chart row: a soft-bordered box with the chart centered above a caption. The three tiles
// share one grid row and stretch to equal height, so each ends up roughly square.
function ChartTile({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="flex aspect-square flex-col gap-1.5 rounded-lg border border-border/70 p-2">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {children}
      </div>
      <span className="text-center text-ui-micro text-ui-muted">{caption}</span>
    </div>
  );
}

// Circular progress ring for today's goal (Duolingo daily-goal mechanic): the brand-colored arc fills toward the
// target and the center reads "done/goal"; once the goal is met the arc turns success-green and the center blooms a
// check. The motivating swap vs. a flat number — the goal-gradient effect pulls the learner to close the ring.
function GoalRing({ value, goal }: { value: number; goal: number }) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  const met = goal > 0 && value >= goal;
  const R = 28;
  const SW = 6;
  const C = 2 * Math.PI * R;
  const box = (R + SW) * 2;
  const center = box / 2;
  return (
    <div className="relative shrink-0" style={{ width: box, height: box }}>
      <svg
        viewBox={`0 0 ${box} ${box}`}
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={R}
          className="fill-none stroke-foreground-10"
          strokeWidth={SW}
        />
        <circle
          cx={center}
          cy={center}
          r={R}
          className={cn(
            "fill-none transition-all duration-500",
            met ? "stroke-success" : "stroke-primary",
          )}
          strokeWidth={SW}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {met ? (
          <CheckIcon className="size-6 text-success duration-300 animate-in zoom-in-50" />
        ) : (
          <>
            <span className="text-ui-body font-semibold leading-none tabular-nums text-foreground">
              {value}
            </span>
            <span className="text-ui-micro leading-none tabular-nums text-ui-muted">
              /{goal}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// Streak header (Duolingo streak mechanic): a flame + day count with three states driven by whether today is already
// counted — lit (warm amber, practiced today), at-risk (grey flame + a loss-aversion nudge when the streak is alive
// from yesterday but today is still empty), and cold (no streak). Surfaces the longest streak as an aspirational
// record once the streak is alive.
function StreakBlock({
  streak,
  longest,
  todayActive,
  t,
}: {
  streak: number;
  longest: number;
  todayActive: boolean;
  t: TFunction;
}) {
  const atRisk = streak > 0 && !todayActive;
  const cold = streak === 0;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <FlameIcon
          className={cn(
            "size-5 shrink-0",
            cold || atRisk ? "text-foreground-40" : "fill-warning text-warning",
          )}
        />
        <span className="text-ui-title font-semibold leading-none tabular-nums text-foreground">
          {t("practiceStats.days", { n: streak })}
        </span>
      </div>
      <span
        className={cn(
          "text-ui-caption",
          atRisk ? "font-medium text-warning" : "text-ui-muted",
        )}
      >
        {cold
          ? t("practiceStats.streakStart")
          : atRisk
            ? t("practiceStats.streakAtRisk", { n: streak })
            : t("practiceStats.streakBest", { n: Math.max(longest, streak) })}
      </span>
    </div>
  );
}

// Month-style activity calendar: HEATMAP_WEEKS week rows × 7 weekday columns ending on the current week. The grid
// stretches to fill the whole chart box (preserveAspectRatio="none"), so its gap to the tile's left, top and right
// edges is the uniform tile padding — equal on all three sides. The 7×HEATMAP_WEEKS layout is close to the box's own
// aspect, so the stretch is mild and cells stay near-square. Days are laid out row-by-row (a row is a week, columns are
// weekdays); future days in the current week are blank and today is outlined.
function CalendarHeatmap({
  dayCounts,
  today,
  locale,
  t,
}: {
  dayCounts: Map<number, number>;
  today: number;
  locale: Locale;
  t: TFunction;
}) {
  // gridStart = the Sunday HEATMAP_WEEKS-1 weeks before this week, so the last row is the current week.
  const todayWeekday = dayDate(today).getUTCDay();
  const gridStart = today - todayWeekday - (HEATMAP_WEEKS - 1) * 7;
  const days = Array.from(
    { length: HEATMAP_WEEKS * 7 },
    (_, i) => gridStart + i,
  );
  const dateFmt = (day: number) =>
    dayDate(day).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

  const CELL = 10;
  const GAP = 3;
  const STEP = CELL + GAP;
  // M = a uniform viewBox inset so no cell sits flush on the boundary — keeps today's stroke and the bottom row from
  // being clipped by the SVG edge. It's the same on every side, so the equal left/top/right margins are preserved.
  const M = 2;
  const W = 7 * STEP - GAP + 2 * M;
  const H = HEATMAP_WEEKS * STEP - GAP + 2 * M;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="size-full overflow-visible"
      role="img"
      aria-label={t("practiceStats.activity")}
    >
      {days.map((day, i) => {
        const future = day > today;
        const c = dayCounts.get(day) ?? 0;
        return (
          <rect
            key={day}
            x={M + (i % 7) * STEP}
            y={M + Math.floor(i / 7) * STEP}
            width={CELL}
            height={CELL}
            rx={2}
            className={cn(
              future ? "fill-transparent" : heatFill(c),
              day === today && "stroke-primary",
            )}
            strokeWidth={day === today ? 1.5 : 0}
            vectorEffect="non-scaling-stroke"
          >
            {!future && (
              <title>
                {t("practiceStats.dayTooltip", {
                  count: c,
                  date: dateFmt(day),
                })}
              </title>
            )}
          </rect>
        );
      })}
    </svg>
  );
}

// Compact sentences/day chart over the last TREND_DAYS — an L-shaped axis frame (y-axis on the left, x-axis baseline)
// with a faint peak gridline, then the area + line. A slim HTML gutter on the left labels the two key Y coordinates —
// the peak (top gridline) and 0 (baseline). The labels stay in HTML so the text is crisp (the plot uses
// preserveAspectRatio="none", which would distort SVG text); they're offset by the same yTop/yBase percentages as the
// plot, so they line up exactly with the gridline and the axis. Non-scaling strokes keep the plot crisp at any size.
function TrendSparkline({
  dayCounts,
  today,
  t,
}: {
  dayCounts: Map<number, number>;
  today: number;
  t: TFunction;
}) {
  const days = Array.from(
    { length: TREND_DAYS },
    (_, i) => today - (TREND_DAYS - 1) + i,
  );
  const values = days.map((d) => dayCounts.get(d) ?? 0);
  const peak = Math.max(...values, 1);

  const W = 100;
  const H = 100;
  const x0 = 1;
  const x1 = 99;
  const yTop = 10;
  const yBase = 90;
  const points = values.map((v, i) => {
    const x = x0 + ((x1 - x0) * i) / (values.length - 1);
    const y = yBase - (yBase - yTop) * (v / peak);
    return [x, y] as const;
  });
  const line = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${x1},${yBase} L${x0},${yBase} Z`;

  return (
    // p-2 insets the chart equally on all sides, so the labels+plot sit centered in the tile with breathing room.
    <div className="flex size-full items-stretch gap-1 p-2">
      {/* Y-axis key coordinates: peak (top gridline) and 0 (baseline), aligned to the plot by percentage offset */}
      <div className="relative h-full w-4 shrink-0 text-ui-micro leading-none tabular-nums text-ui-muted">
        <span
          className="absolute right-0 -translate-y-1/2"
          style={{ top: `${yTop}%` }}
        >
          {peak}
        </span>
        <span
          className="absolute right-0 -translate-y-1/2"
          style={{ top: `${yBase}%` }}
        >
          0
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full min-w-0 flex-1 overflow-visible"
        role="img"
        aria-label={t("practiceStats.trend")}
      >
        {/* peak gridline (top of the plot) */}
        <line
          x1={x0}
          y1={yTop}
          x2={x1}
          y2={yTop}
          className="stroke-foreground-10"
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
        <path d={area} className="fill-primary/10" />
        <path
          d={line}
          className="fill-none stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* L-shaped axes: y-axis down the left, x-axis along the baseline */}
        <path
          d={`M${x0},${yTop} L${x0},${yBase} L${x1},${yBase}`}
          className="fill-none stroke-foreground-20"
          strokeWidth={1}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export function PracticeStats() {
  const { t, locale } = useTranslation();
  const { dailyGoal } = useConfig();
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is a retry trigger only; the effect doesn't read it
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    getLearningStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  if (error) {
    return (
      <div className="flex w-full max-w-md items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-ui-caption text-ui-muted">
        <span className="min-w-0 flex-1 truncate text-destructive" role="alert">
          {t("common.loadFailed")}: {error}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setReloadTick((n) => n + 1)}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex w-full max-w-md items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-ui-caption text-ui-muted">
        <Spinner className="size-4" />
        {t("common.loading")}
      </div>
    );
  }

  const today = localDayNumber(Date.now());
  const todaySentences = stats.dayCounts.get(today) ?? 0;

  return (
    <section className="flex w-full max-w-md flex-col gap-3 rounded-xl border bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <StreakBlock
          streak={stats.currentStreak}
          longest={stats.longestStreak}
          todayActive={todaySentences > 0}
          t={t}
        />
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right text-ui-caption text-ui-muted">
          <span>
            {t("practiceStats.sentencesTotal")}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {stats.totalSentences.toLocaleString()}
            </span>
          </span>
          <span>
            {t("practiceStats.activeDays")}{" "}
            <span className="font-medium tabular-nums text-foreground">
              {stats.activeDays.toLocaleString()}
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <ChartTile caption={t("practiceStats.goalCaption")}>
          <GoalRing value={todaySentences} goal={dailyGoal} />
        </ChartTile>
        <ChartTile caption={t("practiceStats.trendCaption", { n: TREND_DAYS })}>
          <TrendSparkline dayCounts={stats.dayCounts} today={today} t={t} />
        </ChartTile>
        <ChartTile
          caption={t("practiceStats.activityCaption", {
            n: HEATMAP_WEEKS * 7,
          })}
        >
          <CalendarHeatmap
            dayCounts={stats.dayCounts}
            today={today}
            locale={locale}
            t={t}
          />
        </ChartTile>
      </div>

      <p className="m-0 text-ui-caption text-ui-muted">
        {todaySentences >= dailyGoal
          ? t("practiceStats.goalMet")
          : todaySentences > 0
            ? t("practiceStats.goalRemaining", {
                n: dailyGoal - todaySentences,
              })
            : t("practiceStats.goalNone", { goal: dailyGoal })}
      </p>
    </section>
  );
}
