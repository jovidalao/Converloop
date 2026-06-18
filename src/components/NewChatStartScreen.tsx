import { SparklesIcon } from "lucide-react";

import { useTranslation } from "@/i18n";
import { PracticeStats } from "./PracticeStats";
import { type ProviderKind, ProviderStatus } from "./ProviderStatus";
import { TopicStartScreen } from "./TopicStartScreen";

// New-chat start page (shown on an empty practice draft): a Claude-style greeting hero (icon + a time-of-day
// greeting/encouragement line), the practice-stats card, a set of recommended conversation-topic chips generated
// in the background from the learner's profile and recent topics, and a status line with the active LLM/TTS/STT
// providers. Picking a chip materializes the conversation and the AI opens the chat on that topic; typing a first
// message in the composer below starts a normal turn instead.
export function NewChatStartScreen({
  topics,
  refreshing,
  busy,
  onPick,
  onRefresh,
  onOpenProviderSettings,
}: {
  /** null = nothing to show yet; [] = none (silently degrade to type-your-own). */
  topics: string[] | null;
  /** A fresh recommendation fetch is in flight — show the loading skeletons while there are no chips. */
  refreshing: boolean;
  busy: boolean;
  onPick: (topic: string) => void;
  onRefresh: () => void;
  /** Open the settings section for the clicked provider summary item (LLM / TTS / STT). */
  onOpenProviderSettings?: (kind: ProviderKind) => void;
}) {
  const { t } = useTranslation();
  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? t("newChat.greetingNight")
      : hour < 12
        ? t("newChat.greetingMorning")
        : hour < 18
          ? t("newChat.greetingAfternoon")
          : t("newChat.greetingEvening");
  return (
    <TopicStartScreen
      header={
        <div className="flex flex-col gap-4">
          <ProviderStatus onOpen={onOpenProviderSettings} />
          <div className="flex items-center gap-2.5 text-ui-title font-semibold text-foreground">
            <SparklesIcon className="size-6 shrink-0 text-primary" />
            {greeting}
          </div>
        </div>
      }
      recommendedLabel={t("newChat.recommendedTopics")}
      refreshLabel={t("newChat.refresh")}
      topics={topics}
      refreshing={refreshing}
      busy={busy}
      onPick={onPick}
      onRefresh={onRefresh}
    >
      <PracticeStats />
    </TopicStartScreen>
  );
}
