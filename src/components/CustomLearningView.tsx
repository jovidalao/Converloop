import {
  BookOpenCheckIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  deleteLearningAgent,
  type LearningAgentDraft,
  type LearningAgentMeta,
  listLearningAgents,
  updateLearningAgent,
} from "../db/learning-agents";
import type { DrillSummary } from "../drills/types";
import { useConfirm } from "./confirm";
import { DrillIcon } from "./drill-icons";
import { LearningAgentEditDialog } from "./LearningAgentEditDialog";
import { Button } from "./ui/button";

interface CustomLearningViewProps {
  /** Training modes (drills): built-ins + custom, already localized for display. */
  drills: DrillSummary[];
  /** Start a lesson immediately (opens its conversation and kicks off — no intermediate start screen). */
  onStartLesson: (agentId: string) => void;
  /** Open a drill's start page. */
  onStartDrill: (drill: DrillSummary) => void;
  /** Open the create / manage page (project generator, NL creation, import / export). */
  onOpenCreate: () => void;
  /** Refresh the app-level lesson list (command palette) after an edit / delete here. */
  onRefresh: () => Promise<void>;
}

// A training-mode card: icon + name + one-line description, starts the drill on click. Visually matches the
// lesson cards below (same border / hover), so the gallery reads as one surface of mixed training modes + lessons.
function DrillCard({
  drill,
  onStart,
}: {
  drill: DrillSummary;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="group block w-full cursor-pointer rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <span className="flex items-center gap-2">
        <span className="shrink-0 text-primary">
          <DrillIcon name={drill.icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {drill.name}
        </span>
      </span>
      <span className="m-0 mt-1.5 block text-ui-body leading-relaxed text-ui-muted">
        {drill.description}
      </span>
    </button>
  );
}

// Custom-learning gallery: a masonry of lesson cards (built-in + custom) shown in the main area. Each card is its own
// intro — clicking it starts the lesson right away. Custom lessons expose edit / delete on hover. Creating new lessons
// lives on the separate create page, reached via the header button.
export function CustomLearningView({
  drills,
  onStartLesson,
  onStartDrill,
  onOpenCreate,
  onRefresh,
}: CustomLearningViewProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [lessons, setLessons] = useState<LearningAgentMeta[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);

  const reload = useCallback(() => listLearningAgents().then(setLessons), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const editing = lessons.find((l) => l.id === editingId) ?? null;

  async function saveLesson(id: string, patch: Partial<LearningAgentDraft>) {
    await updateLearningAgent(id, patch);
    await reload();
    await onRefresh();
    setEditingId(null);
  }

  async function removeLesson(lesson: LearningAgentMeta) {
    if (lesson.builtIn) return;
    if (
      !(await confirm({
        title: t("sidebar.deleteLessonTitle", { name: lesson.name }),
        description: t("sidebar.deleteLessonDescription"),
      }))
    )
      return;
    await deleteLearningAgent(lesson.id);
    await reload();
    await onRefresh();
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-14 pb-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="mt-0 mb-1 text-ui-title font-semibold tracking-tight">
              {t("customLearning.title")}
            </h2>
            <p className="m-0 max-w-2xl text-ui-body leading-relaxed text-ui-muted">
              {t("customLearning.description")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onOpenCreate}
          >
            <PlusIcon size={15} />
            {t("customLearning.manage")}
          </Button>
        </div>

        <div className="mb-2 text-ui-caption font-medium text-ui-muted">
          {t("customLearning.drillsLabel")}
        </div>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {drills.map((drill) => (
            <DrillCard
              key={drill.id}
              drill={drill}
              onStart={() => onStartDrill(drill)}
            />
          ))}
        </div>

        <div className="mb-2 text-ui-caption font-medium text-ui-muted">
          {t("customLearning.lessonsLabel")}
        </div>
        {lessons.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center text-ui-body text-ui-muted">
            {t("customLearning.empty")}
          </div>
        ) : (
          <div className="columns-1 gap-3 sm:columns-2 xl:columns-3">
            {lessons.map((lesson) => (
              // biome-ignore lint/a11y/useSemanticElements: can't be a <button> — it nests edit/delete action buttons
              <div
                key={lesson.id}
                role="button"
                tabIndex={0}
                className="group relative mb-3 flex w-full cursor-pointer break-inside-avoid flex-col rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                onClick={() =>
                  setExpandedLessonId((cur) =>
                    cur === lesson.id ? null : lesson.id,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedLessonId((cur) =>
                      cur === lesson.id ? null : lesson.id,
                    );
                  }
                }}
              >
                <div className="flex items-center gap-2 pr-12">
                  <BookOpenCheckIcon className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {lesson.name}
                  </span>
                </div>
                {lesson.description && (
                  <p className="m-0 mt-1.5 text-ui-body leading-relaxed text-ui-muted">
                    {lesson.description}
                  </p>
                )}
                {expandedLessonId === lesson.id && (
                  <div className="mt-3 border-t pt-3">
                    <p className="m-0 text-ui-caption leading-snug text-ui-muted">
                      {t("customLearning.previewHint")}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStartLesson(lesson.id);
                      }}
                    >
                      <BookOpenCheckIcon className="size-3.5" />
                      {t("customLearning.startLesson")}
                    </Button>
                  </div>
                )}
                {!lesson.builtIn && (
                  <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-ui-muted hover:bg-accent hover:text-foreground"
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(lesson.id);
                      }}
                    >
                      <PencilIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-ui-muted hover:bg-accent hover:text-foreground"
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeLesson(lesson);
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <LearningAgentEditDialog
          agent={editing}
          onSave={(patch) => void saveLesson(editing.id, patch)}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
