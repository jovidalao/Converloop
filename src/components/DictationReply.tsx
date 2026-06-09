import { ArrowRightIcon, Volume2Icon } from "lucide-react";

import { parseDictationReply } from "../db/conversations";
import { useTranslation } from "../i18n";
import { Markdown } from "./Markdown";
import { SpeakButton } from "./SpeakButton";

// Renders one dictation AI reply: any feedback on the previous transcription (shown when present), then the sentence to
// dictate. While this is the turn awaiting an answer (`masked`), the sentence text is hidden behind a "listen & type"
// card — only the replay button is offered. Before the learner taps into the item (`awaitingEnter`), the card is a
// "next question" gate instead: the sentence and its audio are already prepared, but playback waits for the tap so the
// learner can read their correction first. Once answered (an earlier turn), the correct sentence is revealed.
// TTS always speaks the sentence text (SpeakButton receives the raw sentence), never the feedback.
export function DictationReply({
  text,
  masked,
  awaitingEnter = false,
  onEnter,
}: {
  text: string;
  masked: boolean;
  awaitingEnter?: boolean;
  onEnter?: () => void;
}) {
  const { t } = useTranslation();
  const { feedback, sentence } = parseDictationReply(text);
  return (
    <div className="flex max-w-none flex-col items-start gap-2 self-stretch">
      {feedback ? (
        <div
          className="self-stretch py-0.5 text-foreground"
          data-selectable-context
        >
          <Markdown>{feedback}</Markdown>
        </div>
      ) : null}
      {masked ? (
        awaitingEnter ? (
          <button
            type="button"
            onClick={onEnter}
            className="flex w-full items-center gap-2 self-stretch rounded-xl border bg-card px-3.5 py-3 text-ui-body text-foreground transition-colors hover:bg-accent"
          >
            <ArrowRightIcon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 text-left">
              {t("dictation.nextQuestion")}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2 self-stretch rounded-xl border bg-card px-3.5 py-3 text-ui-body text-ui-muted">
            <Volume2Icon className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {t("dictation.listenPrompt")}
            </span>
            <SpeakButton text={sentence} variant="round" />
          </div>
        )
      ) : (
        // Once answered, the correct sentence is revealed in the same boxed card style as the listen prompt.
        <div className="flex items-start gap-2 self-stretch rounded-xl border bg-card px-3.5 py-3">
          <div
            className="min-w-0 flex-1 text-foreground"
            data-selectable-context
          >
            <Markdown>{sentence}</Markdown>
          </div>
          <SpeakButton text={sentence} variant="round" />
        </div>
      )}
    </div>
  );
}
