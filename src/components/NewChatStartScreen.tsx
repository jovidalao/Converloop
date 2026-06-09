import { SparklesIcon } from "lucide-react";

import { useTranslation } from "@/i18n";
import { TopicStartScreen } from "./TopicStartScreen";

// New-chat start page (shown on an empty practice draft): a short intro and a set of recommended conversation-topic
// chips generated in the background from the learner's profile and recent topics. Picking a chip materializes the
// conversation and the AI opens the chat on that topic; typing a first message in the composer below starts a normal
// turn instead. Thin wrapper over the shared TopicStartScreen.
export function NewChatStartScreen({
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
  onPick: (topic: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <TopicStartScreen
      icon={<SparklesIcon className="size-5 text-primary" />}
      title={t("newChat.startTitle")}
      description={t("newChat.startDescription")}
      recommendedLabel={t("newChat.recommendedTopics")}
      refreshLabel={t("newChat.refresh")}
      topics={topics}
      refreshing={refreshing}
      busy={busy}
      onPick={onPick}
      onRefresh={onRefresh}
    />
  );
}
