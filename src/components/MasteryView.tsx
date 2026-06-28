import {
  ArrowRightIcon,
  CheckCircle2Icon,
  GraduationCapIcon,
  HistoryIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Locale, useTranslation } from "@/i18n";
import {
  deleteMasteryItem,
  getAllMastery,
  getLatestCorrections,
  listMasteryEvents,
  type MasteryCorrection,
  markMasteryKnown,
  updateMasteryItem,
} from "../db/mastery";
import type { MasteryEvent, MasteryItem } from "../db/schema";
import { explainMasteryPoint, MissingApiKeyError } from "../orchestrator";
import { useConfirm } from "./confirm";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";

const TYPE_LABEL: Record<string, string> = {
  vocab: "vocab",
  grammar: "grammar",
  collocation: "collocation",
  error_pattern: "error_pattern",
  expression_gap: "expression_gap",
};

const STATUS_CLASS: Record<string, string> = {
  struggling: "bg-destructive/10 text-destructive",
  learning: "bg-warning/10 text-warning",
  known: "bg-success/10 text-success",
};

function ratio(item: MasteryItem): string {
  if (item.seenCount === 0) return "0/0";
  return `${item.errorCount}/${item.seenCount}`;
}

function dateLabel(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale).format(new Date(ms));
}

function matches(item: MasteryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.label, item.key, item.example, item.notes]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

function Badge({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-ui-caption font-medium ${className}`}
    >
      {children}
    </span>
  );
}

// Tones for the evidence timeline, mirroring the coach panel's signal colors.
const EVENT_KIND_TONE: Record<string, string> = {
  error: "bg-destructive/10 text-destructive",
  correct: "bg-success/10 text-success",
  introduced: "bg-muted text-ui-muted",
  gap: "bg-accent text-primary",
};

// Evidence timeline behind one learning item: every mastery_event recorded for
// its key, newest first. Read-only — this is the audit trail that explains the
// current status/counters.
function MasteryHistory({ itemKey }: { itemKey: string }) {
  const { t, locale } = useTranslation();
  const [events, setEvents] = useState<MasteryEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    void listMasteryEvents(itemKey).then((rows) => {
      if (alive) setEvents(rows);
    });
    return () => {
      alive = false;
    };
  }, [itemKey]);

  if (events === null) {
    return (
      <p className="m-0 mt-2 text-ui-caption text-ui-muted">
        {t("common.loading")}
      </p>
    );
  }
  if (events.length === 0) {
    return (
      <p className="m-0 mt-2 text-ui-caption text-ui-muted">
        {t("mastery.history.empty")}
      </p>
    );
  }
  return (
    <ul className="m-0 mt-2 flex max-h-56 list-none flex-col gap-1 overflow-y-auto border-t p-0 pt-2">
      {events.map((ev) => (
        <li key={ev.id} className="flex items-start gap-2 py-0.5">
          <span
            className={`mt-px shrink-0 rounded-full px-1.5 py-0.5 text-ui-caption font-semibold ${
              EVENT_KIND_TONE[ev.kind] ?? "bg-muted text-ui-muted"
            }`}
          >
            {t(
              `coach.signal.${ev.kind as "error" | "correct" | "introduced" | "gap"}`,
            )}
          </span>
          <span className="min-w-0 flex-1 text-ui-caption leading-snug">
            {(ev.evidence?.trim() || ev.note?.trim()) && (
              <span className="block truncate text-foreground">
                {ev.evidence?.trim() || ev.note?.trim()}
              </span>
            )}
            <span className="text-ui-muted">
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(ev.createdAt))}
              {ev.source !== "tutor" &&
                ` · ${t(`mastery.history.source.${ev.source as "review" | "manual"}`)}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function MasteryRow({
  item,
  correction,
  onRefresh,
}: {
  item: MasteryItem;
  correction?: MasteryCorrection;
  onRefresh: () => void;
}) {
  const { t, locale } = useTranslation();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [example, setExample] = useState(item.example ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");

  // On-demand mini-lesson for this point — same explainer the coach panel uses,
  // so the learner can understand *why* right here in the data view. Generated
  // lazily on first open and cached until regenerated.
  const [lessonOpen, setLessonOpen] = useState(false);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonText, setLessonText] = useState("");
  const [lessonError, setLessonError] = useState<string | null>(null);

  const generateLesson = useCallback(() => {
    setLessonLoading(true);
    setLessonError(null);
    setLessonText("");
    let acc = "";
    void explainMasteryPoint(
      {
        conversationId: null,
        label: item.label,
        type: item.type,
        evidence: item.example?.trim() || undefined,
      },
      (d) => {
        acc += d;
        setLessonText(acc);
      },
    )
      .catch((e) =>
        setLessonError(
          e instanceof MissingApiKeyError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e),
        ),
      )
      .finally(() => setLessonLoading(false));
  }, [item.label, item.type, item.example]);

  const toggleLesson = useCallback(() => {
    if (lessonLoading) return;
    if (!lessonText && !lessonError) {
      setLessonOpen(true);
      generateLesson();
      return;
    }
    setLessonOpen((v) => !v);
  }, [lessonLoading, lessonText, lessonError, generateLesson]);

  async function save() {
    await updateMasteryItem(item.key, { label, example, notes });
    setEditing(false);
    onRefresh();
  }

  async function markKnown() {
    await markMasteryKnown(item.key);
    onRefresh();
  }

  async function remove() {
    if (
      !(await confirm({
        title: t("mastery.deleteTitle", { label: item.label }),
        description: t("mastery.deleteDesc"),
      }))
    )
      return;
    await deleteMasteryItem(item.key);
    onRefresh();
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8 text-ui-body font-medium"
            />
          ) : (
            <div className="truncate text-ui-body font-medium">
              {item.label}
            </div>
          )}
          <div className="mt-1 truncate font-mono text-ui-caption text-ui-muted">
            {item.key}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Badge className="bg-muted text-ui-muted">
            {TYPE_LABEL[item.type] ?? item.type}
          </Badge>
          <Badge className={STATUS_CLASS[item.status] ?? "bg-muted"}>
            {t(
              `mastery.status.${item.status as "struggling" | "learning" | "known"}`,
            )}
          </Badge>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ui-caption text-ui-muted">
        <span>{t("mastery.errorRatio", { ratio: ratio(item) })}</span>
        <span>
          {t("mastery.lastSeen", {
            date: dateLabel(item.lastSeenAt, locale),
          })}
        </span>
      </div>

      {editing ? (
        <div className="mt-3 grid gap-2">
          <Textarea
            value={example}
            onChange={(e) => setExample(e.target.value)}
            className="min-h-16 resize-none text-ui-body"
            placeholder={t("mastery.examplePlaceholder")}
          />
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-16 resize-none text-ui-body"
            placeholder={t("mastery.notesPlaceholder")}
          />
        </div>
      ) : correction ? (
        // Error item: show "your text → correct form" inline so the fix is visible
        // without opening the lesson. The diff mirrors the coach panel's DiffLine.
        <div className="mt-2 grid gap-1.5 text-ui-body leading-relaxed">
          <p className="m-0 flex flex-wrap items-center gap-1.5">
            <span className="text-ui-muted line-through">
              {correction.original}
            </span>
            <ArrowRightIcon size={13} className="shrink-0 text-ui-subtle" />
            <span className="font-medium text-foreground">
              {correction.corrected}
            </span>
          </p>
          {correction.explanation && (
            <p className="m-0 whitespace-pre-wrap text-ui-caption text-ui-muted">
              {correction.explanation}
            </p>
          )}
          {item.notes && (
            <p className="m-0 whitespace-pre-wrap text-ui-muted">
              {item.notes}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 grid gap-1.5 text-ui-body leading-relaxed">
          {item.example && (
            <p className="m-0 whitespace-pre-wrap text-foreground">
              {item.example}
            </p>
          )}
          {item.notes && (
            <p className="m-0 whitespace-pre-wrap text-ui-muted">
              {item.notes}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-0.5">
        {editing ? (
          <>
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => {
                setEditing(false);
                setLabel(item.label);
                setExample(item.example ?? "");
                setNotes(item.notes ?? "");
              }}
              title={t("common.cancel")}
            >
              <XIcon size={15} />
            </Button>
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => void save()}
              disabled={!label.trim()}
              title={t("common.save")}
            >
              <SaveIcon size={15} />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="action"
              size="action"
              data-active={lessonOpen}
              aria-expanded={lessonOpen}
              onClick={toggleLesson}
              title={t("coach.lesson.explain")}
            >
              <GraduationCapIcon size={15} />
            </Button>
            <Button
              type="button"
              variant="action"
              size="action"
              data-active={historyOpen}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              title={t("mastery.history.toggle")}
            >
              <HistoryIcon size={15} />
            </Button>
            {item.status !== "known" && (
              <Button
                type="button"
                variant="action"
                size="action"
                onClick={() => void markKnown()}
                title={t("mastery.markKnown")}
              >
                <CheckCircle2Icon size={15} />
              </Button>
            )}
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => setEditing(true)}
              title={t("common.edit")}
            >
              <PencilIcon size={15} />
            </Button>
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => void remove()}
              title={t("common.delete")}
            >
              <Trash2Icon size={15} />
            </Button>
          </>
        )}
      </div>
      {lessonOpen && !editing && (
        <div className="mt-2 border-t pt-2">
          {lessonLoading && !lessonText ? (
            <span className="inline-flex items-center gap-1.5 text-ui-caption text-ui-muted">
              <Spinner />
              {t("coach.lesson.loading")}
            </span>
          ) : lessonError ? (
            <p className="m-0 text-ui-caption text-destructive">
              {lessonError}
            </p>
          ) : (
            <>
              <Markdown className="text-ui-body leading-relaxed">
                {lessonText}
              </Markdown>
              {!lessonLoading && (
                <button
                  type="button"
                  onClick={generateLesson}
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
      {historyOpen && !editing && <MasteryHistory itemKey={item.key} />}
    </div>
  );
}

export function MasteryView() {
  const { t } = useTranslation();
  const [items, setItems] = useState<MasteryItem[]>([]);
  const [corrections, setCorrections] = useState<
    Map<string, MasteryCorrection>
  >(new Map());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");

  const refresh = useCallback(async () => {
    const all = await getAllMastery();
    setItems(all);
    setCorrections(await getLatestCorrections(all.map((it) => it.key)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          matches(item, query) &&
          (status === "all" || item.status === status) &&
          (type === "all" || item.type === type),
      ),
    [items, query, status, type],
  );

  const types = useMemo(
    () => Array.from(new Set(items.map((item) => item.type))).sort(),
    [items],
  );

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-3 text-ui-title font-semibold tracking-tight">
        {t("sidebar.data")}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border bg-card px-2.5">
          <SearchIcon size={15} className="text-ui-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("mastery.searchPlaceholder")}
            aria-label={t("mastery.searchPlaceholder")}
            spellCheck={false}
            className="min-w-0 flex-1 border-none bg-transparent py-2 text-ui-body outline-none placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border bg-card px-2 text-ui-body outline-none focus-visible:border-ring"
        >
          <option value="all">{t("mastery.allStatuses")}</option>
          <option value="struggling">{t("mastery.status.struggling")}</option>
          <option value="learning">{t("mastery.status.learning")}</option>
          <option value="known">{t("mastery.status.known")}</option>
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 rounded-md border bg-card px-2 text-ui-body outline-none focus-visible:border-ring"
        >
          <option value="all">{t("mastery.allTypes")}</option>
          {types.map((tp) => (
            <option key={tp} value={tp}>
              {TYPE_LABEL[tp] ?? tp}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid gap-2">
        {filtered.map((item) => (
          <MasteryRow
            key={item.key}
            item={item}
            correction={corrections.get(item.key)}
            onRefresh={() => void refresh()}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border bg-card p-4 text-ui-body text-ui-muted">
            {t("mastery.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
