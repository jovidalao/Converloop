import { RefreshCwIcon, ShuffleIcon, ZapIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/i18n";

// Rapid-fire Q&A start page (shown on an empty quickfire draft): a default prompt up top, a set of recommended
// umbrella-scenario chips generated in the background from the learner's records, and a "Random" button. Picking a
// chip / Random — or typing a scenario into the composer below — materializes the conversation and starts the drill.
export function QuickfireStartScreen({
  topics,
  refreshing,
  busy,
  onPick,
  onRandom,
  onRefresh,
}: {
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  /** A fresh recommendation fetch is in flight — show the trailing loading box. */
  refreshing: boolean;
  busy: boolean;
  onPick: (scenario: string) => void;
  onRandom: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const hasTopics = !!topics && topics.length > 0;

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 pt-4 pb-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-ui-title font-semibold text-foreground">
          <ZapIcon className="size-5 text-primary" />
          {t("quickfire.startTitle")}
        </div>
        <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
          {t("quickfire.startDescription")}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-ui-caption font-medium text-ui-muted">
            {t("quickfire.recommendedTopics")}
          </span>
          <div className="flex items-center gap-1">
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
              {t("quickfire.refresh")}
            </Button>
            {/* Always present so it doesn't pop in after loading; enabled once recommendations are available. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-ui-caption"
              disabled={busy || !hasTopics}
              onClick={onRandom}
            >
              <ShuffleIcon className="size-3.5" />
              {t("quickfire.random")}
            </Button>
          </div>
        </div>
        {/* Re-keyed by content so swapping cached → fresh remounts and plays the fade-in transition. */}
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
          {/* Loading box appended after the loaded chips while fresh ones are still coming. */}
          {refreshing && (
            <span className="inline-flex items-center justify-center rounded-full border border-dashed bg-muted/40 px-5 py-1.5">
              <Spinner className="size-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
