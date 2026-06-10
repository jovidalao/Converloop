import { MicIcon } from "lucide-react";

import { useTranslation } from "@/i18n";
import { TopicStartScreen } from "./TopicStartScreen";

// Shadowing (read-aloud) start page (shown on an empty shadowing draft): a heading + description and a set of
// recommended theme chips. Picking a chip — or typing a theme into the composer — materializes the conversation and
// starts the read-aloud drill. Thin wrapper over the shared TopicStartScreen, mirroring DictationStartScreen.
export function ShadowingStartScreen({
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
      icon={<MicIcon className="size-5 text-primary" />}
      title={t("shadowing.startTitle")}
      description={t("shadowing.startDescription")}
      recommendedLabel={t("shadowing.recommendedTopics")}
      refreshLabel={t("shadowing.refresh")}
      topics={topics}
      refreshing={refreshing}
      busy={busy}
      onPick={onPick}
      onRefresh={onRefresh}
    />
  );
}
