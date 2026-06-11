import { CheckCircle2Icon, ListChecksIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/i18n";
import { describeError } from "@/lib/error-display";
import {
  applyLessonSessionMasteryPreview,
  type LessonMasteryPreview,
  previewLessonSessionMastery,
} from "../orchestrator";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Whole-session mastery review for a focused lesson: a bar above the composer that, on demand, runs the bounded
// session-writeback observer over the full transcript and shows the proposed "correct" evidence for the learner to
// confirm in one click. This is how a focused lesson finally feeds the mastery table — the per-message button still
// exists for single answers, but the session review is the discoverable, end-of-lesson path.
export function LessonSessionReview({
  conversationId,
  visible,
}: {
  conversationId: string;
  /** Only shown once the lesson has enough learner output to review. */
  visible: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<LessonMasteryPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    setPreview(null);
    setMessage(null);
    setError(null);
    try {
      const result = await previewLessonSessionMastery(conversationId);
      if (result.signals.length === 0) setMessage(result.summary);
      else setPreview(result);
    } catch (e) {
      setError(describeError(e, t).summary);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview || applying) return;
    setApplying(true);
    setError(null);
    try {
      const result = await applyLessonSessionMasteryPreview(
        conversationId,
        preview,
      );
      setMessage(
        result.applied > 0
          ? t("chat.masteryWritten", { n: result.applied })
          : result.summary,
      );
      setPreview(null);
    } catch (e) {
      setError(describeError(e, t).summary);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="mx-4 mb-1.5 flex flex-col gap-2">
      {!preview && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? (
              <Spinner className="size-3.5" />
            ) : (
              <ListChecksIcon size={14} />
            )}
            {busy
              ? t("lessonReview.reviewing")
              : t("lessonReview.reviewButton")}
          </Button>
          {message && (
            <span className="min-w-0 flex-1 truncate text-ui-caption text-success">
              {message}
            </span>
          )}
          {error && (
            <span
              className="min-w-0 flex-1 truncate text-ui-caption text-destructive"
              role="alert"
              title={error}
            >
              {error}
            </span>
          )}
        </div>
      )}
      {preview && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-ui-body font-medium text-foreground">
              {t("lessonReview.previewTitle")}
            </span>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-ui-muted hover:text-foreground"
              onClick={() => setPreview(null)}
              aria-label={t("common.cancel")}
            >
              <XIcon size={14} />
            </button>
          </div>
          <p className="m-0 text-ui-caption leading-snug text-ui-muted">
            {preview.summary}
          </p>
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {preview.signals.map((signal) => (
              <div
                key={signal.key}
                className="rounded-md bg-muted px-2 py-1.5 text-ui-caption leading-snug text-foreground"
              >
                <span className="font-medium">{signal.label}</span>
                <span className="ml-1 text-ui-muted">({signal.type})</span>
                <span className="mt-0.5 block truncate text-ui-muted">
                  {signal.example}
                </span>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              disabled={applying}
              onClick={() => setPreview(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={applying}
              onClick={() => void apply()}
            >
              {applying ? <Spinner /> : <CheckCircle2Icon size={14} />}
              {t("lessonReview.apply", { n: preview.signals.length })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
