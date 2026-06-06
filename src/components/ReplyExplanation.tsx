import { BookOpenIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { explainReply, MissingApiKeyError } from "../orchestrator";
import { isAgentHidden } from "../runtime";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// The "Explain" button: one click streams an explanation of this reply tailored
// to what the user has mastered. State stays inside the component (transient, not
// persisted) — clicking again collapses/expands, and an already-generated
// explanation is reused. `actions`: other actions rendered earlier on the same
// row (copy / pronounce).
export function ReplyExplanation({
  text,
  actions,
  trailingActions,
  extraPanels,
  onFirstOpen,
  onLayoutChange,
}: {
  text: string;
  actions?: ReactNode;
  trailingActions?: ReactNode;
  extraPanels?: ReactNode;
  /** Fires once the first time the user opens the explanation (comprehension
   * signal accounting, see db/turns). */
  onFirstOpen?: () => void;
  /** Notify the parent scroll container to stick to the bottom when the
   * explanation expands or its streaming content changes. */
  onLayoutChange?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const prevTextRef = useRef(text);

  // Once the reply is replaced by a "regenerate", the old explanation no longer
  // matches, so collapse and reset.
  useEffect(() => {
    if (prevTextRef.current === text) return;
    prevTextRef.current = text;
    setOpen(false);
    setExplanation("");
    setError(null);
  }, [text]);

  useEffect(() => {
    if (open || loading || explanation || error) onLayoutChange?.();
  }, [open, loading, explanation, error, onLayoutChange]);

  async function generate() {
    setLoading(true);
    setError(null);
    setExplanation("");
    let acc = "";
    try {
      await explainReply(text, (d) => {
        acc += d;
        setExplanation(acc);
      });
    } catch (e) {
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClick() {
    if (loading) return;
    if (!explanation && !error) {
      setOpen(true);
      onFirstOpen?.(); // user actively requested an explanation → struggling-to-understand signal
      void generate();
      return;
    }
    setOpen((o) => !o);
  }

  const expanded = open && (explanation || error);
  // When "Reply explanation" is removed (hidden), only the explain button is
  // hidden; copy / read-aloud / bilingual and other actions stay as usual.
  const explainHidden = isAgentHidden("builtin:transformer:explain");

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="-ml-1 flex items-center gap-0.5">
        {actions}
        {!explainHidden && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={!!expanded}
            onClick={handleClick}
            disabled={loading}
            aria-expanded={!!expanded}
            title={t("replyExplanation.explainTooltip")}
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {loading ? (
                <Spinner className="size-3.5 border-transparent border-t-current" />
              ) : (
                <BookOpenIcon className="size-4" />
              )}
            </span>
            <span>{t("replyExplanation.explain")}</span>
          </Button>
        )}
        {trailingActions}
      </div>
      {open && (explanation || error) && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 shadow-sm fade-in-0 slide-in-from-bottom-1 duration-300">
          {error ? (
            <div className="flex items-center gap-3">
              <span
                className="min-w-0 flex-1 text-ui-body leading-snug text-destructive"
                role="alert"
              >
                {error}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1.5"
                disabled={loading}
                onClick={() => void generate()}
              >
                <RefreshCwIcon size={14} />
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <div className="text-ui-body leading-normal text-foreground">
              <Markdown>{explanation}</Markdown>
            </div>
          )}
        </div>
      )}
      {extraPanels}
    </div>
  );
}
