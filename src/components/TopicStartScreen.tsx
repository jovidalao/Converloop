import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Skeleton chip widths (px) shown while topics load — a few blank pills standing in for the real chips.
const SKELETON_WIDTHS = [96, 132, 80, 116, 148, 104];

// Shared start-page body for a topic-chip draft (Rapid Q&A and the new-chat start page): a heading + description, a
// set of recommended chips generated in the background from the learner's records, and a regenerate button. Picking a
// chip materializes the conversation; the per-mode copy/icon and commit behavior are passed in by the thin wrappers
// (QuickfireStartScreen / NewChatStartScreen).
export function TopicStartScreen({
  icon,
  title,
  description,
  header,
  recommendedLabel,
  refreshLabel,
  topics,
  refreshing,
  busy,
  onPick,
  onRefresh,
  children,
  footer,
}: {
  icon?: ReactNode;
  title?: string;
  description?: string;
  /** Replaces the default icon + title + description header (the new-chat page uses a Claude-style hero instead). */
  header?: ReactNode;
  recommendedLabel: string;
  refreshLabel: string;
  /** Optional content slot between the header and the topic chips (the new-chat page embeds the practice-stats card here). */
  children?: ReactNode;
  /** Optional content slot below the topic chips (the new-chat page shows the active-provider status line here). */
  footer?: ReactNode;
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  /** A fresh recommendation fetch is in flight — show the loading skeletons while there are no chips. */
  refreshing: boolean;
  busy: boolean;
  onPick: (topic: string) => void;
  onRefresh: () => void;
}) {
  const hasTopics = !!topics && topics.length > 0;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 pt-4 pb-2">
      {header ?? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-ui-title font-semibold text-foreground">
            {icon}
            {title}
          </div>
          <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
            {description}
          </p>
        </div>
      )}

      {children}

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

      {footer}
    </div>
  );
}
