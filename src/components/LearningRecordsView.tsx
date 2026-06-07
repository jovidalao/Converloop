import {
  FlameIcon,
  PencilLineIcon,
  TriangleAlertIcon,
  TrophyIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type Locale, type TFunction, useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getLearningStats,
  type LearningStats,
  localDayNumber,
  type MistakeRow,
} from "../db/learning-stats";

// Read-only "achievements" page (Settings → Profile database). Duolingo-style:
// stat cards + a practice-activity heatmap + a recent-trend chart + a mastery
// breakdown + the mistakes worth remembering. No editing happens here — the
// editable learning data lives on the Data page.

const HEATMAP_WEEKS = 26;
const TREND_DAYS = 14;
const DAY_MS = 86_400_000;

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

function StatCard({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  tone: string;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/80 p-4 shadow-minimal-flat">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            tone,
          )}
        >
          {icon}
        </span>
        <span className="text-ui-caption font-medium text-ui-muted">
          {label}
        </span>
      </div>
      <span className="font-semibold text-[1.65rem] leading-none tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-ui-caption text-ui-muted">{sub}</span>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/80 p-5 shadow-minimal-flat">
      <h3 className="mt-0 mb-0.5 text-ui-body font-semibold text-foreground">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-0 mb-4 text-ui-caption text-ui-muted">{subtitle}</p>
      )}
      {children}
    </section>
  );
}

// GitHub-style contribution grid: 7 weekday rows × HEATMAP_WEEKS columns, ending
// on the current week. Month labels sit above the column where the month turns.
function ActivityHeatmap({
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
  const lastColStart = today - todayWeekday; // Sunday of the current week
  const gridStart = lastColStart - (HEATMAP_WEEKS - 1) * 7;

  const columns = Array.from({ length: HEATMAP_WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, r) => gridStart + w * 7 + r),
  );

  // Place a month label above the first column whose top cell starts a new month.
  let lastMonth = -1;
  const monthMarks: { col: number; label: string }[] = [];
  columns.forEach((col, i) => {
    const d = dayDate(col[0]);
    const month = d.getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      monthMarks.push({
        col: i,
        label: d.toLocaleDateString(locale, {
          month: "short",
          timeZone: "UTC",
        }),
      });
    }
  });

  const dateFmt = (day: number) =>
    dayDate(day).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-1">
        <div className="relative h-4">
          {monthMarks.map((m) => (
            <span
              key={m.col}
              className="absolute whitespace-nowrap text-ui-micro text-ui-muted"
              style={{ left: `${m.col * 16}px` }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {columns.map((col) => (
            <div key={col[0]} className="flex flex-col gap-[3px]">
              {col.map((day) => {
                const future = day > today;
                const c = dayCounts.get(day) ?? 0;
                return (
                  <div
                    key={day}
                    className={cn(
                      "size-[13px] rounded-[3px]",
                      future ? "bg-transparent" : heatColor(c),
                    )}
                    title={
                      future
                        ? undefined
                        : t("records.activity.dayTooltip", {
                            count: c,
                            date: dateFmt(day),
                          })
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-ui-micro text-ui-muted">
          <span>{t("records.activity.less")}</span>
          {[
            "bg-foreground-5",
            "bg-primary/25",
            "bg-primary/50",
            "bg-primary/75",
            "bg-primary",
          ].map((c) => (
            <span key={c} className={cn("size-[11px] rounded-[3px]", c)} />
          ))}
          <span>{t("records.activity.more")}</span>
        </div>
      </div>
    </div>
  );
}

// SVG area + line of sentences/day over the last TREND_DAYS. Stretched to the
// container width (preserveAspectRatio="none") with a non-scaling stroke so the
// line stays crisp at any width.
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
      <p className="m-0 text-ui-body text-ui-muted">
        {t("records.trend.empty")}
      </p>
    );
  }

  const W = 600;
  const H = 140;
  const pad = 6;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const points = values.map((v, i) => {
    const x = pad + (innerW * i) / (values.length - 1);
    const y = pad + innerH * (1 - v / peak);
    return [x, y] as const;
  });
  const line = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`,
    )
    .join(" ");
  const baseline = pad + innerH;
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${baseline} L${points[0][0].toFixed(1)},${baseline} Z`;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={t("records.trend.title")}
      >
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
      <div className="flex justify-between text-ui-micro text-ui-muted">
        <span>{labelFor(days[0])}</span>
        <span>{t("records.trend.peak", { n: peak })}</span>
        <span>{labelFor(days[days.length - 1])}</span>
      </div>
    </div>
  );
}

function MasteryBar({ stats, t }: { stats: LearningStats; t: TFunction }) {
  const total = stats.totalKnowledge;
  if (total === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("records.mastery.empty")}
      </p>
    );
  }
  const segments = [
    {
      key: "known",
      label: t("records.mastery.known"),
      value: stats.mastered,
      bar: "bg-success",
      dot: "bg-success",
    },
    {
      key: "learning",
      label: t("records.mastery.learning"),
      value: stats.learning,
      bar: "bg-warning",
      dot: "bg-warning",
    },
    {
      key: "struggling",
      label: t("records.mastery.struggling"),
      value: stats.struggling,
      bar: "bg-destructive",
      dot: "bg-destructive",
    },
  ];
  return (
    <div className="flex flex-col gap-3">
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

function MistakeList({
  mistakes,
  locale,
  t,
}: {
  mistakes: MistakeRow[];
  locale: Locale;
  t: TFunction;
}) {
  if (mistakes.length === 0) {
    return (
      <p className="m-0 text-ui-body text-ui-muted">
        {t("records.mistakes.empty")}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {mistakes.map((m) => (
        <li
          key={m.key}
          className="flex flex-col gap-1 rounded-lg border border-border/70 bg-background/45 px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-ui-caption font-medium text-ui-muted">
              {t(`coach.type.${m.type}`)}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {m.label}
            </span>
            <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-ui-caption font-semibold text-destructive">
              {t("records.mistakes.timesWrong", { n: m.errorCount })}
            </span>
          </div>
          {m.example?.trim() && (
            <p
              className="m-0 truncate text-ui-caption text-ui-muted"
              title={m.example}
            >
              {m.example.trim()}
            </p>
          )}
          <span className="text-ui-micro text-ui-muted">
            {t("records.mistakes.lastSeen", {
              date: new Date(m.lastSeenAt).toLocaleDateString(locale),
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LearningRecordsView() {
  const { t, locale } = useTranslation();
  const [stats, setStats] = useState<LearningStats | null>(null);

  useEffect(() => {
    let alive = true;
    void getLearningStats().then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const today = localDayNumber(Date.now());
  const empty =
    stats && stats.totalSentences === 0 && stats.totalKnowledge === 0;

  return (
    <div className="h-full overflow-y-auto px-6 pt-14 pb-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 space-y-1">
          <h2 className="mt-0 text-ui-title font-semibold tracking-tight">
            {t("records.title")}
          </h2>
          <p className="m-0 text-ui-body text-ui-muted">
            {t("records.subtitle")}
          </p>
        </div>

        {!stats ? (
          <p className="m-0 text-ui-body text-ui-muted">
            {t("common.loading")}
          </p>
        ) : empty ? (
          <div className="rounded-xl border border-border/70 bg-card/80 p-8 text-center text-ui-body text-ui-muted shadow-minimal-flat">
            {t("records.empty")}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<PencilLineIcon className="size-4" />}
                tone="bg-info/10 text-info"
                label={t("records.stat.sentences")}
                value={stats.totalSentences.toLocaleString()}
                sub={t("records.stat.sentencesSub", { days: stats.activeDays })}
              />
              <StatCard
                icon={<FlameIcon className="size-4" />}
                tone="bg-warning/10 text-warning"
                label={t("records.stat.streak")}
                value={t("records.stat.streakValue", {
                  n: stats.currentStreak,
                })}
                sub={t("records.stat.streakSub", { n: stats.longestStreak })}
              />
              <StatCard
                icon={<TrophyIcon className="size-4" />}
                tone="bg-success/10 text-success"
                label={t("records.stat.mastered")}
                value={stats.mastered.toLocaleString()}
                sub={t("records.stat.masteredSub", { n: stats.totalKnowledge })}
              />
              <StatCard
                icon={<TriangleAlertIcon className="size-4" />}
                tone="bg-destructive/10 text-destructive"
                label={t("records.stat.mistakes")}
                value={stats.mistakeTotal.toLocaleString()}
                sub={t("records.stat.mistakesSub")}
              />
            </div>

            <Panel
              title={t("records.activity.title")}
              subtitle={t("records.activity.subtitle")}
            >
              <ActivityHeatmap
                dayCounts={stats.dayCounts}
                today={today}
                locale={locale}
                t={t}
              />
            </Panel>

            <Panel
              title={t("records.trend.title")}
              subtitle={t("records.trend.subtitle")}
            >
              <TrendChart
                dayCounts={stats.dayCounts}
                today={today}
                locale={locale}
                t={t}
              />
            </Panel>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel
                title={t("records.mastery.title")}
                subtitle={t("records.mastery.subtitle")}
              >
                <MasteryBar stats={stats} t={t} />
              </Panel>
              <Panel
                title={t("records.mistakes.title")}
                subtitle={t("records.mistakes.subtitle")}
              >
                <MistakeList mistakes={stats.mistakes} locale={locale} t={t} />
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
