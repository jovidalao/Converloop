import { CheckIcon, RefreshCwIcon } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useConfig } from "../../config";
import { useTranslation } from "../../i18n";
import {
  getReplyTransformers,
  type ReplyTransformer,
  runReplyTransformer,
  type TransformerStage,
} from "../../runtime";
import { Markdown } from "../Markdown";
import { replyTransformerIcon } from "../reply-transformer-icons";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/** One open drop-below popup at a time within a message; null = all closed. */
export type ActivePanelId = string | null;

// Custom transformers (user-created, kind="reply_transformer") render as per-turn buttons — under the AI
// reply (stage="ai_reply") or under the learner's own message (stage="user_message"), selected via the `stage` arg.
// Output by mode: panel = drop-below Markdown card; replace = swap the bubble (lifted to PartnerReply, ai_reply only);
// coach/memory = persist a side artifact and show a brief ✓. See runtime/custom-agents.runCustomReplyTransformer.

type Status = {
  loading: boolean;
  error: string | null;
  markdown: string | null; // cached output (panel/replace), reused on re-open without re-running
  ack: boolean; // coach/memory: last run succeeded
};

const EMPTY: Status = {
  loading: false,
  error: null,
  markdown: null,
  ack: false,
};

export interface ReplyTransformerItem {
  id: string;
  transformer: ReplyTransformer;
  panelId: string;
  loading: boolean;
  error: string | null;
  markdown: string | null;
  ack: boolean;
  panelOpen: boolean;
  active: boolean;
  onClick: () => void;
  onRetry: () => void;
}

export interface ReplyTransformersControl {
  items: ReplyTransformerItem[];
  /** Markdown that should replace the reply bubble (output mode "replace"), or null. */
  replaceMarkdown: string | null;
  clearReplace: () => void;
}

export function useReplyTransformers({
  stage,
  turnId,
  text,
  enabled = true,
  activePanelId,
  setActivePanelId,
  onLayoutChange,
  onReplaceActivate,
}: {
  /** Which turn this hook is mounted on: ai_reply (under the AI reply) or user_message (under the learner's turn). */
  stage: TransformerStage;
  turnId: string;
  text: string;
  /** When false, no buttons render and auto-run transformers do not fire (e.g. off-record /btw or prompt-macro turns). */
  enabled?: boolean;
  activePanelId: ActivePanelId;
  setActivePanelId: Dispatch<SetStateAction<ActivePanelId>>;
  onLayoutChange?: () => void;
  /** Activating a "replace" transformer should close any in-place bilingual view (both own the bubble). */
  onReplaceActivate?: () => void;
}): ReplyTransformersControl {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the enabled list per turn (stage/turnId/text), not from values used in the body
  const transformers = useMemo(
    () => (enabled ? getReplyTransformers(stage) : []),
    [enabled, stage, turnId, text],
  );
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [replace, setReplace] = useState<{
    id: string;
    markdown: string;
  } | null>(null);
  const genRef = useRef(0);
  const resetKey = `${turnId}:${text}`;
  const prevResetRef = useRef(resetKey);
  const didAutoRunRef = useRef("");

  const panelIdOf = useCallback((id: string) => `${turnId}:rt:${id}`, [turnId]);

  const update = useCallback((id: string, patch: Partial<Status>) => {
    setStatuses((s) => ({ ...s, [id]: { ...EMPTY, ...s[id], ...patch } }));
  }, []);

  // New reply → drop all transient state. Declared before the auto-run effect so it clears first.
  useEffect(() => {
    if (prevResetRef.current === resetKey) return;
    prevResetRef.current = resetKey;
    genRef.current++;
    setStatuses({});
    setReplace(null);
  }, [resetKey]);

  const run = useCallback(
    async (tr: ReplyTransformer) => {
      const gen = genRef.current;
      update(tr.id, { loading: true, error: null });
      try {
        const result = await runReplyTransformer(tr.id, {
          turnId,
          text,
        });
        if (genRef.current !== gen) return null;
        update(tr.id, { loading: false });
        return result;
      } catch (e) {
        if (genRef.current !== gen) return null;
        update(tr.id, {
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      }
    },
    [turnId, text, update],
  );

  // Run and route the result by output mode. Does not read `statuses`, so it is safe to call from the auto-run effect.
  const runAndApply = useCallback(
    (tr: ReplyTransformer) => {
      if (tr.outputMode === "panel") setActivePanelId(panelIdOf(tr.id));
      void run(tr).then((r) => {
        if (!r) return;
        if (r.markdown != null) {
          update(tr.id, { markdown: r.markdown });
          if (tr.outputMode === "replace") {
            setReplace({ id: tr.id, markdown: r.markdown });
            onReplaceActivate?.();
          }
        } else {
          update(tr.id, { ack: true });
        }
      });
    },
    [run, update, setActivePanelId, panelIdOf, onReplaceActivate],
  );

  const onClick = useCallback(
    (tr: ReplyTransformer) => {
      const st = statuses[tr.id] ?? EMPTY;
      if (st.loading) return;
      const panelId = panelIdOf(tr.id);
      // panel: cached → just toggle visibility (re-run via the panel's retry button).
      if (tr.outputMode === "panel" && (st.markdown || st.error)) {
        setActivePanelId((cur) => (cur === panelId ? null : panelId));
        return;
      }
      // replace: toggle off if active, re-activate cached output without re-running.
      if (tr.outputMode === "replace") {
        if (replace?.id === tr.id) {
          setReplace(null);
          return;
        }
        if (st.markdown) {
          setReplace({ id: tr.id, markdown: st.markdown });
          onReplaceActivate?.();
          return;
        }
      }
      runAndApply(tr);
    },
    [
      statuses,
      replace,
      panelIdOf,
      setActivePanelId,
      onReplaceActivate,
      runAndApply,
    ],
  );

  const onRetry = useCallback(
    (tr: ReplyTransformer) => {
      update(tr.id, { error: null, markdown: null });
      runAndApply(tr);
    },
    [update, runAndApply],
  );

  const clearReplace = useCallback(() => setReplace(null), []);

  // Auto-run transformers fire once per new reply.
  useEffect(() => {
    if (didAutoRunRef.current === resetKey) return;
    didAutoRunRef.current = resetKey;
    for (const tr of transformers) if (tr.autoRun) runAndApply(tr);
  }, [resetKey, transformers, runAndApply]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin scroll when transformer state (statuses/panel/replace) changes the layout
  useEffect(() => {
    onLayoutChange?.();
  }, [statuses, activePanelId, replace, onLayoutChange]);

  const items: ReplyTransformerItem[] = transformers.map((tr) => {
    const st = statuses[tr.id] ?? EMPTY;
    const panelId = panelIdOf(tr.id);
    const panelOpen = tr.outputMode === "panel" && activePanelId === panelId;
    return {
      id: tr.id,
      transformer: tr,
      panelId,
      loading: st.loading,
      error: st.error,
      markdown: st.markdown,
      ack: st.ack,
      panelOpen,
      active:
        panelOpen || (tr.outputMode === "replace" && replace?.id === tr.id),
      onClick: () => onClick(tr),
      onRetry: () => onRetry(tr),
    };
  });

  return {
    items,
    replaceMarkdown: replace?.markdown ?? null,
    clearReplace,
  };
}

export function ReplyTransformerButtons({
  items,
}: {
  items: ReplyTransformerItem[];
}) {
  const { actionLabels } = useConfig();
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) => {
        const { transformer: tr } = item;
        const Icon = replyTransformerIcon(tr.icon);
        const acked =
          item.ack && (tr.outputMode === "coach" || tr.outputMode === "memory");
        return (
          <Button
            key={item.id}
            type="button"
            variant="action"
            size="action"
            data-active={item.active || acked}
            onClick={item.onClick}
            disabled={item.loading}
            aria-pressed={item.active}
            title={item.error ?? tr.card.title}
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {item.loading ? (
                <Spinner className="size-3.5 border-transparent border-t-current" />
              ) : acked ? (
                <CheckIcon className="size-4" />
              ) : (
                <Icon
                  className={`size-4${item.error ? " text-destructive" : ""}`}
                />
              )}
            </span>
            {actionLabels && <span data-compact-label>{tr.card.title}</span>}
          </Button>
        );
      })}
    </>
  );
}

export function ReplyTransformerPanels({
  items,
}: {
  items: ReplyTransformerItem[];
}) {
  const { t } = useTranslation();
  const open = items.filter(
    (i) =>
      i.transformer.outputMode === "panel" &&
      i.panelOpen &&
      (i.loading || i.markdown || i.error),
  );
  if (open.length === 0) return null;
  return (
    <>
      {open.map((item) => (
        <div
          key={item.id}
          className="w-full animate-in rounded-lg border bg-card p-3 shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200"
        >
          {item.error ? (
            <div className="flex items-center gap-3">
              <span
                className="min-w-0 flex-1 text-ui-body leading-snug text-destructive"
                role="alert"
              >
                {item.error}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1.5"
                disabled={item.loading}
                onClick={item.onRetry}
              >
                <RefreshCwIcon size={14} />
                {t("common.retry")}
              </Button>
            </div>
          ) : item.markdown ? (
            <div
              className="text-ui-body leading-normal text-foreground"
              data-selectable-context
            >
              <Markdown>{item.markdown}</Markdown>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ui-body text-ui-muted">
              <Spinner />
              {item.transformer.card.title}
            </span>
          )}
        </div>
      ))}
    </>
  );
}
