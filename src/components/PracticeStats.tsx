import { useEffect, useState } from "react";

import { type Locale, type TFunction, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getLearningStats,
  type LearningStats,
  localDayNumber,
} from "../db/learning-stats";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Practice-stats card on the new-chat start page (slotted between the header and the topic chips), modeled on the
// Claude macOS usage card: a tab row at the top switches between overview (stat tiles + activity heatmap), the
// recent-trend chart, and the mastery breakdown. This card replaced the settings "Achievements" page — it is the
// only stats surface. Read-only; the drills themselves are launched from the sidebar, the command palette, or the
// Practice Center.

const HEATMAP_WEEKS = 32;
const TREND_DAYS = 14;
const DAY_MS = 86_400_000;

type StatsTab = "overview" | "trend" | "mastery";
const TABS: readonly StatsTab[] = ["overview", "trend", "mastery"];

// dayNumber → UTC-midnight Date (localDayNumber is built from Date.UTC, so the
// inverse reads back with the UTC accessors / a UTC-pinned formatter).
function dayDate(day: number): Date {
  return new Date(day * DAY_MS);
}

function heatColor(count: number): string {
  if (count <= 0) return "bg-foreground-5";
  if (count <= 2) return "bg-primary/25";
  if (count <= 5) return "bg-primary/50";
  if (count <= 9) return "bg-primary/75";
  return "bg-primary";
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted px-2.5 py-1.5">
      <span className="truncate text-ui-caption text-ui-muted">{label}</span>
      <span className="font-semibold text-ui-body leading-snug tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

// Compact contribution grid: 7 weekday rows × HEATMAP_WEEKS week columns ending on the current week, stretched to the
// card width (no month labels or legend).
function CompactHeatmap({
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

  return (
    <div
      className="grid grid-flow-col grid-rows-7 gap-[3px]"
      style={{ gridAutoColumns: "minmax(0, 1fr)" }}
    >
      {days.map((day) => {
        const future = day > today;
        const c = dayCounts.get(day) ?? 0;
        return (
          <div
            key={day}
            className={cn(
              "aspect-square w-full rounded-[3px]",
              future ? "bg-transparent" : heatColor(c),
            )}
            title={
              future
                ? undefined
                : t("practiceStats.dayTooltip", {
                    count: c,
                    date: dateFmt(day),
                  })
            }
          />
        );
      })}
    </div>
  );
}

// SVG area + line of sentences/day over the last TREND_DAYS, with horizontal gridlines, integer y-axis tick labels
// (HTML column beside the SVG), and start/middle/end date labels. The plot is stretched to the container width
// (preserveAspectRatio="none") with non-scaling strokes so lines stay crisp at any width.
function TrendChart({
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
  const days = Array.from(
    { length: TREND_DAYS },
    (_, i) => today - (TREND_DAYS - 1) + i,
  );
  const values = days.map((d) => dayCounts.get(d) ?? 0);
  const peak = Math.max(...values);

  const labelFor = (day: number) =>
    dayDate(day).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

  if (peak === 0) {
    return (
      <p className="m-0 py-4 text-center text-ui-caption text-ui-muted">
        {t("practiceStats.trendEmpty")}
      </p>
    );
  }

  // Integer ticks: round the axis max up to a multiple of the step so the
  // gridlines land on whole sentence counts.
  const TICK_COUNT = 3;
  const step = Math.ceil(peak / TICK_COUNT);
  const axisMax = step * TICK_COUNT;
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => i * step);

  const W = 600;
  const H = 160;
  const points = values.map((v, i) => {
    const x = (W * i) / (values.length - 1);
    const y = H * (1 - v / axisMax);
    return [x, y] as const;
  });
  const line = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-stretch gap-2">
        <div className="flex flex-col justify-between text-right text-ui-micro tabular-nums text-ui-muted">
          {[...ticks].reverse().map((v) => (
            <span key={v} className="leading-none">
              {v}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-32 min-w-0 flex-1 overflow-visible"
          role="img"
          aria-label={t("practiceStats.trend")}
        >
          {ticks.map((v) => {
            const y = H * (1 - v / axisMax);
            return (
              <line
                key={v}
                x1={0}
                x2={W}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <path d={area} className="fill-primary/10" />
          <path
            d={line}
            className="fill-none stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="flex justify-between pl-5 text-ui-micro text-ui-muted">
        <span>{labelFor(days[0])}</span>
        <span>{labelFor(days[Math.floor(days.length / 2)])}</span>
        <span>{labelFor(days[days.length - 1])}</span>
      </div>
    </div>
  );
}

function MasteryBar({ stats, t }: { stats: LearningStats; t: TFunction }) {
  const total = stats.totalKnowledge;
  if (total === 0) {
    return (
      <p className="m-0 py-4 text-center text-ui-caption text-ui-muted">
        {t("practiceStats.masteryEmpty")}
      </p>
    );
  }
  const segments = [
    {
      key: "known",
      label: t("practiceStats.mastered"),
      value: stats.mastered,
      bar: "bg-success",
      dot: "bg-success",
    },
    {
      key: "learning",
      label: t("practiceStats.learning"),
      value: stats.learning,
      bar: "bg-warning",
      dot: "bg-warning",
    },
    {
      key: "struggling",
      label: t("practiceStats.struggling"),
      value: stats.struggling,
      bar: "bg-destructive",
      dot: "bg-destructive",
    },
  ];
  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-foreground-5">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.key}
              className={s.bar}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <span
            key={s.key}
            className="flex items-center gap-1.5 text-ui-caption text-ui-muted"
          >
            <span className={cn("size-2 rounded-full", s.dot)} />
            {s.label}
            <span className="font-semibold tabular-nums text-foreground">
              {s.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function PracticeStats() {
  const { t, locale } = useTranslation();
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [tab, setTab] = useState<StatsTab>("overview");

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
      <div className="flex w-full max-w-lg items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-ui-caption text-ui-muted">
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
      <div className="flex w-full max-w-lg items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-ui-caption text-ui-muted">
        <Spinner className="size-4" />
        {t("common.loading")}
      </div>
    );
  }

  const today = localDayNumber(Date.now());
  const todaySentences = stats.dayCounts.get(today) ?? 0;
  const tiles: { label: string; value: string }[] = [
    {
      label: t("practiceStats.sentencesToday"),
      value: todaySentences.toLocaleString(),
    },
    {
      label: t("practiceStats.sentencesTotal"),
      value: stats.totalSentences.toLocaleString(),
    },
    {
      label: t("practiceStats.activeDays"),
      value: stats.activeDays.toLocaleString(),
    },
    {
      label: t("practiceStats.currentStreak"),
      value: t("practiceStats.days", { n: stats.currentStreak }),
    },
  ];

  return (
    <section className="flex w-full max-w-lg flex-col gap-2.5 rounded-xl border bg-card p-3.5">
      <div className="flex items-center gap-1">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-2 py-1 text-ui-caption transition-colors",
              tab === key
                ? "bg-muted font-medium text-foreground"
                : "text-ui-muted hover:text-foreground",
            )}
          >
            {t(`practiceStats.${key}`)}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => (
              <StatTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
              />
            ))}
          </div>
          <CompactHeatmap
            dayCounts={stats.dayCounts}
            today={today}
            locale={locale}
            t={t}
          />
          <p className="m-0 text-ui-caption text-ui-muted">
            {todaySentences > 0
              ? t("practiceStats.progressSoFar", { n: todaySentences })
              : t("practiceStats.progressNone")}
          </p>
        </>
      ) : tab === "trend" ? (
        <TrendChart
          dayCounts={stats.dayCounts}
          today={today}
          locale={locale}
          t={t}
        />
      ) : (
        <MasteryBar stats={stats} t={t} />
      )}
    </section>
  );
}
