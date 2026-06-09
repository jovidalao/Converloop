import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { QuickfireTopicsDebug } from "../orchestrator";

// Skeleton chip widths (px) shown while topics load — a few blank pills standing in for the real chips.
const SKELETON_WIDTHS = [96, 132, 80, 116, 148, 104];

// Shared start-page body for a topic-chip draft (Rapid Q&A and the new-chat start page): a heading + description, a
// set of recommended chips generated in the background from the learner's records, a regenerate button, and a
// collapsible debug panel. Picking a chip materializes the conversation; the per-mode copy/icon and commit behavior
// are passed in by the thin wrappers (QuickfireStartScreen / NewChatStartScreen).
export function TopicStartScreen({
  icon,
  title,
  description,
  recommendedLabel,
  refreshLabel,
  debugTitle,
  topics,
  refreshing,
  debug,
  busy,
  onPick,
  onRefresh,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  recommendedLabel: string;
  refreshLabel: string;
  debugTitle: string;
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  /** A fresh recommendation fetch is in flight — show the loading skeletons while there are no chips. */
  refreshing: boolean;
  /** Diagnostics from the last fetch (raw response / fallback flag / counts), shown in a collapsible debug panel. */
  debug: QuickfireTopicsDebug | null;
  busy: boolean;
  onPick: (topic: string) => void;
  onRefresh: () => void;
}) {
  const hasTopics = !!topics && topics.length > 0;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 pt-4 pb-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-ui-title font-semibold text-foreground">
          {icon}
          {title}
        </div>
        <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
          {description}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-ui-caption font-medium text-ui-muted">
            {recommendedLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-ui-caption"
            disabled={busy || refreshing}
            onClick={onRefresh}
          >
            {refreshing ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            {refreshLabel}
          </Button>
        </div>
        {refreshing && !hasTopics ? (
          // Loading skeletons: blank pill placeholders where chips will appear (regenerate discards the old set and
          // reloads). Fades in as a group; each box pulses.
          <div className="flex flex-wrap gap-2 animate-in fade-in-0 duration-300">
            {SKELETON_WIDTHS.map((w) => (
              <span
                key={w}
                className="h-8 animate-pulse rounded-full bg-muted"
                style={{ width: w }}
              />
            ))}
          </div>
        ) : (
          // Re-keyed by content so swapping skeletons/cached → fresh remounts and plays the fade-in transition.
          <div
            key={(topics ?? []).join("|")}
            className="flex flex-wrap gap-2 animate-in fade-in-0 duration-300"
          >
            {topics?.map((topic) => (
              <button
                key={topic}
                type="button"
                disabled={busy}
                onClick={() => onPick(topic)}
                className="rounded-full border bg-card px-3.5 py-1.5 text-ui-body text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                {topic}
              </button>
            ))}
          </div>
        )}
      </div>

      {debug && (
        <details
          className="rounded-lg border bg-muted/30 text-ui-caption"
          open={!!debug.error || debug.usedFallback || debug.parsedCount === 0}
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-ui-muted">
            {debugTitle} · parsed={debug.parsedCount}
            {debug.usedFallback ? " · fallback" : ""} · {debug.elapsedMs}ms
          </summary>
          <div className="space-y-1.5 border-t px-3 py-2 font-mono text-ui-muted">
            <div>
              provider={debug.providerConfigured ? "yes" : "no"} · model=
              {debug.model || "(none)"}
            </div>
            <div>
              records: weak={debug.weakCount} recent={debug.recentCount}{" "}
              profile={debug.profileChars}c · avoid-sent={debug.avoidCount}
            </div>
            <div>
              usedFallback={debug.usedFallback ? "yes (hardcoded list!)" : "no"}
            </div>
            {debug.error && (
              <div className="whitespace-pre-wrap text-destructive">
                error: {debug.error}
              </div>
            )}
            <div>
              raw response:
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-foreground">
                {debug.rawResponse ??
                  "(none — request not sent or threw before responding)"}
              </pre>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
