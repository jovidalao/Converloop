import {
  BookOpenCheckIcon,
  CheckIcon,
  ClipboardCopyIcon,
  CopyPlusIcon,
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
import {
  createDrill,
  deleteDrill,
  duplicateDrill,
  getDrill,
  updateDrill,
} from "../drills/store";
import type { DrillDefinition, DrillSummary } from "../drills/types";
import { useConfirm } from "./confirm";
import { DrillDocumentDialog } from "./DrillDocumentDialog";
import { DrillIcon } from "./drill-icons";
import { LearningAgentEditDialog } from "./LearningAgentEditDialog";
import { type ProviderKind, ProviderStatus } from "./ProviderStatus";
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
  /** Open the settings section for a provider summary item (LLM / TTS / STT). */
  onOpenProviderSettings?: (kind: ProviderKind) => void;
  /** Refresh the app-level lesson list (command palette) after an edit / delete here. */
  onRefresh: () => Promise<void>;
  /** Refresh the app-level drill list after create / edit / duplicate / delete here. */
  onRefreshDrills: () => Promise<void>;
}

// A training-mode card: icon + name + one-line description, starts the drill on click. Visually matches the
// lesson cards below (same border / hover). Hover actions: built-ins offer "duplicate to customize" +
// export (the built-ins double as format examples for new drills); custom drills add edit + delete.
function DrillCard({
  drill,
  exported,
  onStart,
  onDuplicate,
  onExport,
  onEdit,
  onDelete,
}: {
  drill: DrillSummary;
  /** Briefly true after export — flips the icon to a check as copy feedback. */
  exported: boolean;
  onStart: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: can't be a <button> — it nests the hover action buttons
    <div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStart();
        }
      }}
      className="group relative block w-full cursor-pointer rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
    >
      <span className="flex items-center gap-2 pr-16">
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
      <span className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {drill.builtIn ? (
          <button
            type="button"
            className="rounded-md p-1.5 text-ui-muted hover:bg-accent hover:text-foreground"
            title={t("customLearning.duplicateDrill")}
            aria-label={t("customLearning.duplicateDrill")}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <CopyPlusIcon className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="rounded-md p-1.5 text-ui-muted hover:bg-accent hover:text-foreground"
            title={t("common.edit")}
            aria-label={t("common.edit")}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <PencilIcon className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          className="rounded-md p-1.5 text-ui-muted hover:bg-accent hover:text-foreground"
          title={t("customLearning.exportDrill")}
          aria-label={t("customLearning.exportDrill")}
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
        >
          {exported ? (
            <CheckIcon className="size-3.5 text-success" />
          ) : (
            <ClipboardCopyIcon className="size-3.5" />
          )}
        </button>
        {!drill.builtIn && (
          <button
            type="button"
            className="rounded-md p-1.5 text-ui-muted hover:bg-accent hover:text-foreground"
            title={t("common.delete")}
            aria-label={t("common.delete")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        )}
      </span>
    </div>
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
  onOpenProviderSettings,
  onRefresh,
  onRefreshDrills,
}: CustomLearningViewProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [lessons, setLessons] = useState<LearningAgentMeta[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  // Drill dialogs: "create" opens the blank document dialog; editing holds the loaded custom drill.
  const [creatingDrill, setCreatingDrill] = useState(false);
  const [editingDrill, setEditingDrill] = useState<{
    id: string;
    sourceMd: string;
  } | null>(null);
  // Card id whose document was just copied — flips that card's export icon to a check for a moment.
  const [exportedDrillId, setExportedDrillId] = useState<string | null>(null);

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

  async function saveNewDrill(sourceMd: string, def: DrillDefinition) {
    await createDrill(sourceMd, def);
    await onRefreshDrills();
    setCreatingDrill(false);
  }

  async function saveDrillEdit(sourceMd: string, def: DrillDefinition) {
    if (!editingDrill) return;
    await updateDrill(editingDrill.id, sourceMd, def);
    await onRefreshDrills();
    setEditingDrill(null);
  }

  async function duplicateDrillById(id: string) {
    const record = await getDrill(id);
    if (!record) return;
    await duplicateDrill(record);
    await onRefreshDrills();
  }

  async function exportDrill(id: string) {
    const record = await getDrill(id);
    if (!record) return;
    await navigator.clipboard.writeText(record.sourceMd);
    setExportedDrillId(id);
    window.setTimeout(
      () => setExportedDrillId((cur) => (cur === id ? null : cur)),
      2500,
    );
  }

  async function openDrillEditor(id: string) {
    const record = await getDrill(id);
    if (!record) return;
    setEditingDrill({ id: record.id, sourceMd: record.sourceMd });
  }

  async function removeDrill(drill: DrillSummary) {
    if (drill.builtIn) return;
    if (
      !(await confirm({
        title: t("customLearning.deleteDrillTitle", { name: drill.name }),
        description: t("customLearning.deleteDrillDescription"),
      }))
    )
      return;
    await deleteDrill(drill.id);
    await onRefreshDrills();
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
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-4 pb-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex flex-col gap-4">
          <ProviderStatus onOpen={onOpenProviderSettings} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="mt-0 mb-1 flex items-center gap-2.5 text-ui-title font-semibold">
                <BookOpenCheckIcon className="size-6 shrink-0 text-primary" />
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
        </div>

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-ui-caption font-medium text-ui-muted">
            {t("customLearning.drillsLabel")}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ui-caption text-primary hover:bg-accent"
            onClick={() => setCreatingDrill(true)}
          >
            <PlusIcon size={13} />
            {t("customLearning.newDrill")}
          </button>
        </div>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {drills.map((drill) => (
            <DrillCard
              key={drill.id}
              drill={drill}
              exported={exportedDrillId === drill.id}
              onStart={() => onStartDrill(drill)}
              onDuplicate={() => void duplicateDrillById(drill.id)}
              onExport={() => void exportDrill(drill.id)}
              onEdit={() => void openDrillEditor(drill.id)}
              onDelete={() => void removeDrill(drill)}
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
      {creatingDrill && (
        <DrillDocumentDialog
          mode="create"
          onSave={saveNewDrill}
          onCancel={() => setCreatingDrill(false)}
        />
      )}
      {editingDrill && (
        <DrillDocumentDialog
          mode="edit"
          initialMd={editingDrill.sourceMd}
          onSave={saveDrillEdit}
          onCancel={() => setEditingDrill(null)}
        />
      )}
    </div>
  );
}
