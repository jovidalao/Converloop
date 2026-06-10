import {
  BookOpenCheckIcon,
  CheckCircle2Icon,
  FlameIcon,
  HeadphonesIcon,
  MicIcon,
  TargetIcon,
  ZapIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { useTranslation } from "@/i18n";
import {
  type ConversationType,
  conversationType,
  listConversations,
} from "../db/conversations";
import { listLearningAgents } from "../db/learning-agents";
import {
  listLearningProjects,
  projectNextLessonId,
} from "../db/learning-projects";
import { getLearningStats, localDayNumber } from "../db/learning-stats";
import { countListeningFocusWords, getReviewDueList } from "../db/mastery";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

interface TodayData {
  currentStreak: number;
  todaySentences: number;
  dueCount: number;
  dueLabels: string[];
  listeningCount: number;
  /** Conversation types already practiced today (a conversation of that type was active today). */
  doneToday: Set<ConversationType>;
  /** Next lesson of the most recent active project, if any. */
  nextLesson: {
    projectTitle: string;
    lessonId: string;
    lessonName: string;
  } | null;
}

async function loadTodayData(): Promise<TodayData> {
  const [stats, due, listeningCount, conversations, projects, agents] =
    await Promise.all([
      getLearningStats(),
      getReviewDueList(5),
      countListeningFocusWords(),
      listConversations(),
      listLearningProjects(),
      listLearningAgents(),
    ]);
  const today = localDayNumber(Date.now());
  const doneToday = new Set<ConversationType>();
  for (const c of conversations) {
    if (localDayNumber(c.updatedAt) === today)
      doneToday.add(conversationType(c));
  }
  let nextLesson: TodayData["nextLesson"] = null;
  for (const project of projects) {
    if (project.status !== "active") continue;
    const lessonId = projectNextLessonId(project);
    if (!lessonId) continue;
    const agent = agents.find((a) => a.id === lessonId);
    if (!agent) continue;
    nextLesson = {
      projectTitle: project.title,
      lessonId,
      lessonName: agent.name,
    };
    break;
  }
  return {
    currentStreak: stats.currentStreak,
    todaySentences: stats.dayCounts.get(today) ?? 0,
    dueCount: due.length,
    dueLabels: due.map((item) => item.label),
    listeningCount,
    doneToday,
    nextLesson,
  };
}

function PlaylistCard({
  icon,
  title,
  reason,
  done,
  actionLabel,
  onStart,
}: {
  icon: ReactNode;
  title: string;
  reason: string;
  done: boolean;
  actionLabel: string;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{title}</span>
          {done && (
            <span className="inline-flex items-center gap-1 text-ui-caption text-success">
              <CheckCircle2Icon size={13} />
              {t("today.done")}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-ui-caption leading-snug text-ui-muted">
          {reason}
        </span>
      </span>
      <Button
        type="button"
        variant={done ? "ghost" : "outline"}
        size="sm"
        className="shrink-0"
        onClick={onStart}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

// Daily training: an orchestration layer over the existing drills, not a new agent. Answers "what should I practice
// today?" from data the app already records — due review items → weak-spot drill, shaky listening words → dictation,
// streak/sentence counts → the habit header — and surfaces the active project's next lesson. "Done" marks are derived
// from today's conversations per drill type (no extra storage).
export function TodayView({
  onStartReviewDrill,
  onStartDictation,
  onStartShadowing,
  onStartQuickfire,
  onStartLesson,
}: {
  onStartReviewDrill: () => void;
  onStartDictation: () => void;
  onStartShadowing: () => void;
  onStartQuickfire: () => void;
  onStartLesson: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<TodayData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTodayData().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ui-muted">
        <Spinner className="size-4" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-14 pb-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="m-0 text-ui-title font-semibold tracking-tight">
            {t("today.title")}
          </h2>
          {data.currentStreak > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-ui-caption font-semibold text-warning">
              <FlameIcon size={13} />
              {t("today.streak", { n: data.currentStreak })}
            </span>
          )}
        </div>
        <p className="mt-0 mb-5 text-ui-body leading-relaxed text-ui-muted">
          {data.todaySentences > 0
            ? t("today.progressSoFar", { n: data.todaySentences })
            : t("today.progressNone")}
        </p>

        <div className="flex flex-col gap-2">
          <PlaylistCard
            icon={<TargetIcon className="size-4" />}
            title={t("today.reviewDrillTitle")}
            reason={
              data.dueCount > 0
                ? t("today.reviewDrillReason", {
                    n: data.dueCount,
                    items: data.dueLabels.slice(0, 3).join(" · "),
                  })
                : t("today.reviewDrillEmpty")
            }
            done={data.doneToday.has("review_drill")}
            actionLabel={t("today.start")}
            onStart={onStartReviewDrill}
          />
          <PlaylistCard
            icon={<HeadphonesIcon className="size-4" />}
            title={t("today.dictationTitle")}
            reason={
              data.listeningCount > 0
                ? t("today.dictationReason", { n: data.listeningCount })
                : t("today.dictationFresh")
            }
            done={data.doneToday.has("dictation")}
            actionLabel={t("today.start")}
            onStart={onStartDictation}
          />
          <PlaylistCard
            icon={<MicIcon className="size-4" />}
            title={t("today.shadowingTitle")}
            reason={t("today.shadowingReason")}
            done={data.doneToday.has("shadowing")}
            actionLabel={t("today.start")}
            onStart={onStartShadowing}
          />
          <PlaylistCard
            icon={<ZapIcon className="size-4" />}
            title={t("today.quickfireTitle")}
            reason={t("today.quickfireReason")}
            done={data.doneToday.has("quickfire")}
            actionLabel={t("today.start")}
            onStart={onStartQuickfire}
          />
          {data.nextLesson && (
            <PlaylistCard
              icon={<BookOpenCheckIcon className="size-4" />}
              title={t("today.projectTitle", {
                project: data.nextLesson.projectTitle,
              })}
              reason={t("today.projectReason", {
                lesson: data.nextLesson.lessonName,
              })}
              done={data.doneToday.has("learning_agent")}
              actionLabel={t("today.start")}
              onStart={() => {
                if (data.nextLesson) onStartLesson(data.nextLesson.lessonId);
              }}
            />
          )}
        </div>

        <p className="mt-4 text-ui-caption leading-relaxed text-ui-muted">
          {t("today.hint")}
        </p>
      </div>
    </div>
  );
}
