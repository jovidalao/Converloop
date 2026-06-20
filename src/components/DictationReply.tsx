import { ArrowRightIcon, SnailIcon, Volume2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { parseDictationReply } from "../db/conversations";
import { useTranslation } from "../i18n";
import { playSpeech, stopSpeech } from "../tts/playback";
import { speakText } from "../tts/speak";
import { Markdown } from "./Markdown";
import { SpeakButton } from "./SpeakButton";
import { Spinner } from "./ui/spinner";

// Replay controls for the sentence awaiting an answer: normal replay + slow replay (0.7×, pitch preserved).
// Every replay is reported via onReplay — the orchestrator feeds the count to the agent as a live difficulty
// signal for the NEXT sentence (more replays → ease off a little).
function ReplayControls({
  sentence,
  onReplay,
}: {
  sentence: string;
  onReplay?: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<"normal" | "slow" | null>(null);
  // Surface TTS failures (e.g. missing key): a silent no-op replay button is indistinguishable from a dead one.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function replay(rate: number, kind: "normal" | "slow") {
    if (loading || !sentence.trim()) return;
    setLoading(kind);
    setError(null);
    try {
      stopSpeech();
      const audio = await speakText(sentence);
      onReplay?.();
      setLoading(null);
      await playSpeech(audio, sentence, { rate });
    } catch (e) {
      setLoading(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <span className="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="inline-flex size-[1.65rem] items-center justify-center rounded-full bg-accent text-primary transition-colors hover:bg-accent/70"
        onClick={() => void replay(1, "normal")}
        title={t("dictation.replay")}
        aria-label={t("dictation.replay")}
      >
        {loading === "normal" ? (
          <Spinner className="size-3" />
        ) : (
          <Volume2Icon size={15} />
        )}
      </button>
      <button
        type="button"
        className="inline-flex size-[1.65rem] items-center justify-center rounded-full bg-accent text-primary transition-colors hover:bg-accent/70"
        onClick={() => void replay(0.7, "slow")}
        title={t("dictation.slowReplay")}
        aria-label={t("dictation.slowReplay")}
      >
        {loading === "slow" ? (
          <Spinner className="size-3" />
        ) : (
          <SnailIcon size={15} />
        )}
      </button>
      {error && (
        <span
          className="absolute right-0 top-[calc(100%+4px)] z-[2] flex w-max max-w-64 items-start gap-1.5 rounded border border-destructive/20 bg-card px-2 py-1.5 text-ui-caption leading-tight text-destructive shadow-minimal"
          role="alert"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            className="-mr-0.5 shrink-0 rounded p-0.5 text-ui-muted hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setError(null)}
            aria-label={t("common.close")}
          >
            <XIcon size={12} />
          </button>
        </span>
      )}
    </span>
  );
}

// Renders one dictation AI reply: any feedback on the previous attempt (shown when present), then the
// target sentence hidden behind a "listen & type" card while it awaits an answer. Before the learner taps
// into the item (`awaitingEnter`), the card is a "next question" gate — the sentence and its audio are
// prepared, but playback waits for the tap so the learner can read their correction first.
// TTS always speaks the sentence text, never the feedback.
export function DictationReply({
  text,
  masked,
  awaitingEnter = false,
  onEnter,
  onReplay,
}: {
  text: string;
  masked: boolean;
  awaitingEnter?: boolean;
  onEnter?: () => void;
  /** Fired on each manual replay (normal or slow) of the awaiting sentence. */
  onReplay?: () => void;
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
            <ReplayControls sentence={sentence} onReplay={onReplay} />
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
