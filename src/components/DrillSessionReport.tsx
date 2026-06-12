import { FileTextIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/i18n";
import { describeError } from "@/lib/error-display";
import { generateDrillSessionReport } from "../orchestrator";
import { CopyButton } from "./chat/turns";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// End-of-session report for drills whose document has a # Report section: a bar above the composer
// (mirroring LessonSessionReview) that runs the report instructions over the transcript and shows
// the Markdown wrap-up inline. Read-only — closing it discards the text.
export function DrillSessionReport({
  conversationId,
  visible,
}: {
  conversationId: string;
  /** Only shown once the session has enough learner output to report on. */
  visible: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  async function run() {
    if (busy) return;
    setBusy(true);
    setReport(null);
    setError(null);
    try {
      setReport(await generateDrillSessionReport(conversationId));
    } catch (e) {
      setError(describeError(e, t).summary);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-4 mb-1.5 flex flex-col gap-2">
      {!report && (
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
              <FileTextIcon size={14} />
            )}
            {busy ? t("drillReport.generating") : t("drillReport.button")}
          </Button>
          {error && (
            <span className="min-w-0 flex-1 text-ui-caption text-destructive">
              {error}
            </span>
          )}
        </div>
      )}
      {report && (
        <div className="rounded-lg border bg-card px-3.5 py-3">
          <div className="mb-1 flex items-center gap-1.5">
            <FileTextIcon size={14} className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-ui-caption font-medium text-ui-muted">
              {t("drillReport.title")}
            </span>
            <CopyButton text={report} />
            <button
              type="button"
              className="rounded p-0.5 text-ui-muted hover:text-foreground"
              onClick={() => setReport(null)}
              aria-label={t("common.close")}
            >
              <XIcon size={13} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto text-ui-body">
            <Markdown>{report}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
