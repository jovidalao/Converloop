import { MessageSquareReplyIcon, RefreshCwIcon } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReplySuggestionSource } from "../../agents/reply-suggestion";
import { useConfig } from "../../config";
import { useTranslation } from "../../i18n";
import { MissingApiKeyError, suggestReply } from "../../orchestrator";
import { Markdown } from "../Markdown";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/** One open drop-below popup at a time within a message; null = all closed. */
export type ActivePanelId = string | null;

export interface ReplySuggestionControl {
  open: boolean;
  loading: boolean;
  text: string;
  error: string | null;
  warning: string | null;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}

export function useReplySuggestion({
  conversationId,
  turnId,
  source,
  panelId,
  activePanelId,
  setActivePanelId,
  resetKey,
  onLayoutChange,
}: {
  conversationId: string;
  turnId: string;
  source: ReplySuggestionSource;
  panelId: string;
  activePanelId: ActivePanelId;
  setActivePanelId: Dispatch<SetStateAction<ActivePanelId>>;
  resetKey: string;
  onLayoutChange?: () => void;
}): ReplySuggestionControl {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const previousResetKeyRef = useRef(resetKey);
  const open = activePanelId === panelId;

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    requestIdRef.current++;
    setActivePanelId((current) => (current === panelId ? null : current));
    setLoading(false);
    setText("");
    setError(null);
    setWarning(null);
  }, [panelId, resetKey, setActivePanelId]);

  useEffect(() => {
    if (open || loading || text || error || warning) onLayoutChange?.();
  }, [open, loading, text, error, warning, onLayoutChange]);

  async function generate() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setWarning(null);
    setText("");
    let acc = "";
    try {
      const result = await suggestReply(conversationId, turnId, source, (d) => {
        if (requestIdRef.current !== requestId) return;
        acc += d;
        setText(acc);
      });
      if (requestIdRef.current === requestId) {
        setText(result.text);
        setWarning(
          result.finishReason?.kind === "length"
            ? t("chat.replySuggestionTruncated", {
                provider: result.finishReason.provider,
                raw: result.finishReason.raw,
              })
            : null,
        );
      }
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }

  function toggle() {
    if (loading) return;
    if (!text && !error) {
      setActivePanelId(panelId);
      void generate();
      return;
    }
    setActivePanelId((current) => (current === panelId ? null : panelId));
  }

  return {
    open,
    loading,
    text,
    error,
    warning,
    expanded: open && (loading || !!text || !!error),
    onToggle: toggle,
    onRetry: () => void generate(),
  };
}

export function ReplySuggestionButton({
  suggestion,
}: {
  suggestion: ReplySuggestionControl;
}) {
  const { t } = useTranslation();
  const { actionLabels } = useConfig();
  return (
    <Button
      type="button"
      variant="action"
      size="action"
      data-active={suggestion.expanded}
      onClick={suggestion.onToggle}
      disabled={suggestion.loading}
      aria-expanded={suggestion.expanded}
      title={t("chat.generateReplySuggestion")}
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <MessageSquareReplyIcon className="size-4" />
      </span>
      {actionLabels && (
        <span data-compact-label>{t("chat.replySuggestion")}</span>
      )}
    </Button>
  );
}

export function ReplySuggestionPanel({
  suggestion,
}: {
  suggestion: ReplySuggestionControl;
}) {
  const { t } = useTranslation();
  if (
    !suggestion.open ||
    (!suggestion.loading && !suggestion.text && !suggestion.error)
  )
    return null;
  return (
    <div className="w-full animate-in rounded-lg border bg-card p-3 shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
      {suggestion.error ? (
        <div className="flex items-center gap-3">
          <span
            className="min-w-0 flex-1 text-ui-body leading-snug text-destructive"
            role="alert"
          >
            {suggestion.error}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5"
            disabled={suggestion.loading}
            onClick={suggestion.onRetry}
          >
            <RefreshCwIcon size={14} />
            {t("common.retry")}
          </Button>
        </div>
      ) : suggestion.text ? (
        <div className="min-w-0 space-y-2">
          {suggestion.warning && (
            <p className="m-0 rounded-md bg-warning/10 px-2 py-1.5 text-ui-caption leading-snug text-warning">
              {suggestion.warning}
            </p>
          )}
          <div
            className="text-ui-body leading-normal text-foreground"
            data-selectable-context
          >
            <Markdown>{suggestion.text}</Markdown>
          </div>
        </div>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-ui-body text-ui-muted">
          <Spinner />
          {t("chat.generatingReplySuggestion")}
        </span>
      )}
    </div>
  );
}
