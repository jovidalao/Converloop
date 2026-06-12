import { useTranslation } from "@/i18n";
import type { DrillSummary } from "../drills/types";
import { DrillIcon } from "./drill-icons";
import { TopicStartScreen } from "./TopicStartScreen";
import { Button } from "./ui/button";

// Generic drill start page (shown on an empty drill draft), driven entirely by the drill document:
// icon/name/intro from its (localized) display fields. setup: "topic" renders the shared topic-chip
// screen (recommended themes + type-your-own composer below); setup: "none" renders a plain Start
// button. setup: "review-items" has its own screen (ReviewDrillStartScreen).
export function DrillStartScreen({
  drill,
  topics,
  refreshing,
  busy,
  onPickTopic,
  onStart,
  onRefresh,
}: {
  drill: Pick<DrillSummary, "name" | "intro" | "icon" | "setup">;
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  refreshing: boolean;
  busy: boolean;
  onPickTopic: (topic: string) => void;
  /** setup: "none" — start without parameters. */
  onStart: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const icon = <DrillIcon name={drill.icon} className="size-5 text-primary" />;
  if (drill.setup !== "topic") {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-5 pt-4 pb-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-ui-title font-semibold text-foreground">
            {icon}
            {drill.name}
          </div>
          <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
            {drill.intro}
          </p>
        </div>
        <Button
          type="button"
          className="self-start"
          disabled={busy}
          onClick={onStart}
        >
          <DrillIcon name={drill.icon} className="size-4" />
          {t("drill.start")}
        </Button>
      </div>
    );
  }
  return (
    <TopicStartScreen
      icon={icon}
      title={drill.name}
      description={drill.intro}
      recommendedLabel={t("drill.recommendedTopics")}
      refreshLabel={t("drill.refresh")}
      topics={topics}
      refreshing={refreshing}
      busy={busy}
      onPick={onPickTopic}
      onRefresh={onRefresh}
    />
  );
}
