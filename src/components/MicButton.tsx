import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { type ActiveRecording, startRecording } from "../stt/record";
import { transcribeAudio } from "../stt/transcribe";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Composer voice input: click to record, click again to stop → transcribe →
// hand the text to the composer (the learner reviews before sending — that
// review is itself part of the learning loop). Esc cancels a recording.
export function MicButton({
  disabled = false,
  onTranscript,
  onError,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const recordingRef = useRef<ActiveRecording | null>(null);

  // Discard any live recording on unmount (conversation switch etc.).
  useEffect(() => {
    return () => {
      recordingRef.current?.cancel();
      recordingRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        recordingRef.current?.cancel();
        recordingRef.current = null;
        setState("idle");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

  async function toggle() {
    if (disabled || state === "transcribing") return;
    if (state === "idle") {
      try {
        recordingRef.current = await startRecording();
        setState("recording");
      } catch {
        onError(t("stt.micDenied"));
      }
      return;
    }
    const active = recordingRef.current;
    recordingRef.current = null;
    if (!active) {
      setState("idle");
      return;
    }
    setState("transcribing");
    try {
      const { blob, mime } = await active.stop();
      const text = await transcribeAudio(blob, mime);
      if (text) onTranscript(text);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setState("idle");
    }
  }

  return (
    <Button
      type="button"
      size="icon"
      variant={state === "recording" ? "default" : "ghost"}
      onClick={() => void toggle()}
      disabled={disabled || state === "transcribing"}
      className={`size-8 rounded-full transition-transform active:scale-90${
        state === "recording" ? " animate-pulse" : ""
      }`}
      title={
        state === "recording" ? t("stt.stopRecording") : t("stt.startRecording")
      }
      aria-label={
        state === "recording" ? t("stt.stopRecording") : t("stt.startRecording")
      }
      aria-pressed={state === "recording"}
    >
      {state === "transcribing" ? (
        <Spinner className="size-3.5" />
      ) : state === "recording" ? (
        <SquareIcon className="size-3 fill-current" />
      ) : (
        <MicIcon className="size-4" />
      )}
    </Button>
  );
}
