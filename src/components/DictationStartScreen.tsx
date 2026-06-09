import { HeadphonesIcon } from "lucide-react";

import { useTranslation } from "@/i18n";
import { TopicStartScreen } from "./TopicStartScreen";

// Dictation start page (shown on an empty dictation draft): a heading + description and a set of recommended theme
// chips generated in the background from the learner's records. Picking a chip — or typing a theme into the composer
// below — materializes the conversation and starts the listening drill. Thin wrapper over the shared TopicStartScreen,
// mirroring QuickfireStartScreen.
export function DictationStartScreen({
  topics,
  refreshing,
  busy,
  onPick,
  onRefresh,
}: {
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  refreshing: boolean;
  busy: boolean;
  onPick: (theme: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TopicStartScreen
      icon={<HeadphonesIcon className="size-5 text-primary" />}
      title={t("dictation.startTitle")}
      description={t("dictation.startDescription")}
      recommendedLabel={t("dictation.recommendedTopics")}
      refreshLabel={t("dictation.refresh")}
      topics={topics}
      refreshing={refreshing}
      busy={busy}
      onPick={onPick}
      onRefresh={onRefresh}
    />
  );
}
