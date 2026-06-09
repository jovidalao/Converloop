import { ZapIcon } from "lucide-react";

import { useTranslation } from "@/i18n";
import { TopicStartScreen } from "./TopicStartScreen";

// Rapid-fire Q&A start page (shown on an empty quickfire draft): a default prompt up top and a set of recommended
// umbrella-scenario chips generated in the background from the learner's records. Picking a chip — or typing a
// scenario into the composer below — materializes the conversation and starts the drill. Thin wrapper over the
// shared TopicStartScreen, which holds the chip / skeleton / refresh markup.
export function QuickfireStartScreen({
  topics,
  refreshing,
  busy,
  onPick,
  onRefresh,
}: {
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  /** A fresh recommendation fetch is in flight — show the loading skeletons while there are no chips. */
  refreshing: boolean;
  busy: boolean;
  onPick: (scenario: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TopicStartScreen
      icon={<ZapIcon className="size-5 text-primary" />}
      title={t("quickfire.startTitle")}
      description={t("quickfire.startDescription")}
      recommendedLabel={t("quickfire.recommendedTopics")}
      refreshLabel={t("quickfire.refresh")}
      topics={topics}
      refreshing={refreshing}
      busy={busy}
      onPick={onPick}
      onRefresh={onRefresh}
    />
  );
}
