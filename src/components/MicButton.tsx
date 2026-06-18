import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  actionAriaKeyshortcuts,
  actionShortcutLabel,
  matchesActionShortcut,
} from "@/lib/app-actions";
import { isPronunciationEnabled } from "../pronunciation/config";
import {
  loadSttConfig,
  MissingSttApiKeyError,
  MissingSttProviderError,
  STT_CONFIG_CHANGED_EVENT,
} from "../stt/config";
import { type LocalCapture, startLocalCapture } from "../stt/local";
import { type StreamingSession, startSonioxStream } from "../stt/realtime";
import { type ActiveRecording, startRecording } from "../stt/record";
import { transcribeAudio } from "../stt/transcribe";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Composer voice input, split by STT engine:
//  - Soniox (stream): real-time streaming; onPartial keeps pushing final + tentative text
//    into the composer, then onTranscript settles the final text after stop.
//  - OpenAI-compatible (batch): record the whole utterance -> upload -> onTranscript.
//  - Parakeet / Qwen3 (local): record the whole utterance -> local sherpa-onnx -> onTranscript.
// Contract: once a streaming session has emitted onPartial, it must end with one
// onTranscript call ("" on cancel/error) so callers can roll back or settle the text.
// The learner still confirms the transcript before sending; that confirmation is
// part of the learning flow. Esc cancels recording.
type LiveSession =
  | { kind: "stream"; session: StreamingSession }
  | { kind: "batch"; recording: ActiveRecording }
  | { kind: "local"; capture: LocalCapture };

export function MicButton({
  disabled = false,
  onTranscript,
  onPartial,
  onError,
  onAudio,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onPartial: (text: string) => void;
  onError: (message: string) => void;
  /** When pronunciation feedback is on, hands the parent the raw recording of this utterance for assessment. */
  onAudio?: (audio: { blob: Blob; mime: string }) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const [providerSelected, setProviderSelected] = useState(
    () => loadSttConfig().sttProvider !== null,
  );
  const sessionRef = useRef<LiveSession | null>(null);
  // Auxiliary raw recorder for pronunciation feedback on the streaming/local STT paths (which expose only
  // text). The batch path already yields a blob, so it reuses that instead of starting one here.
  const pronRecordingRef = useRef<ActiveRecording | null>(null);

  useEffect(() => {
    const syncProviderSelection = () => {
      setProviderSelected(loadSttConfig().sttProvider !== null);
    };
    window.addEventListener(STT_CONFIG_CHANGED_EVENT, syncProviderSelection);
    window.addEventListener("storage", syncProviderSelection);
    return () => {
      window.removeEventListener(
        STT_CONFIG_CHANGED_EVENT,
        syncProviderSelection,
      );
      window.removeEventListener("storage", syncProviderSelection);
    };
  }, []);

  // Discard any live recording on unmount (conversation switch etc.).
  useEffect(() => {
    return () => {
      const live = sessionRef.current;
      sessionRef.current = null;
      if (live?.kind === "stream") live.session.cancel();
      else if (live?.kind === "batch") live.recording.cancel();
      else if (live?.kind === "local") live.capture.cancel();
      pronRecordingRef.current?.cancel();
      pronRecordingRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        const live = sessionRef.current;
        sessionRef.current = null;
        if (live?.kind === "stream") {
          live.session.cancel();
          onTranscript(""); // Roll back tentative text already streamed into the composer.
        } else if (live?.kind === "batch") {
          live.recording.cancel();
        } else if (live?.kind === "local") {
          live.capture.cancel();
        }
        pronRecordingRef.current?.cancel();
        pronRecordingRef.current = null;
        setState("idle");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, onTranscript]);

  // ⌘⇧V toggles recording from anywhere in the composer. Routed through a ref so the
  // global listener subscribes once (not on every render); toggle() self-guards on
  // disabled/transcribing, so the handler just forwards.
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    toggleRef.current = () => void toggle();
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing || e.defaultPrevented) return;
      if (!matchesActionShortcut(e, "voice-input")) return;
      e.preventDefault();
      toggleRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function toggle() {
    if (disabled || state === "transcribing") return;
    if (state === "idle") {
      try {
        const provider = loadSttConfig().sttProvider;
        setProviderSelected(provider !== null);
        if (!provider) throw new MissingSttProviderError();
        // Pronunciation feedback needs the raw audio. The batch path captures a blob anyway (reused at
        // stop); the streaming/local paths expose only text, so record a parallel blob just for assessment.
        // Best-effort — a failed aux capture must never block voice input.
        if (onAudio && isPronunciationEnabled() && provider !== "openai") {
          try {
            pronRecordingRef.current = await startRecording();
          } catch {
            pronRecordingRef.current = null;
          }
        }
        if (provider === "soniox") {
          const session = await startSonioxStream({
            onPartial,
            onError: (e) => {
              // Recording-time connection failure: the session self-cleaned; roll back tentative text.
              sessionRef.current = null;
              pronRecordingRef.current?.cancel();
              pronRecordingRef.current = null;
              setState("idle");
              onTranscript("");
              onError(e.message);
            },
          });
          sessionRef.current = { kind: "stream", session };
        } else if (provider === "parakeet" || provider === "qwen3") {
          sessionRef.current = {
            kind: "local",
            capture: await startLocalCapture(provider),
          };
        } else {
          sessionRef.current = {
            kind: "batch",
            recording: await startRecording(),
          };
        }
        setState("recording");
      } catch (e) {
        // STT setup failed — release the aux pronunciation recorder if it managed to start.
        pronRecordingRef.current?.cancel();
        pronRecordingRef.current = null;
        onError(
          e instanceof MissingSttProviderError ||
            e instanceof MissingSttApiKeyError
            ? e.message
            : t("stt.micDenied"),
        );
      }
      return;
    }
    const live = sessionRef.current;
    sessionRef.current = null;
    if (!live) {
      setState("idle");
      return;
    }
    // The aux recorder (streaming/local paths) is stopped alongside the STT session; the batch path reuses
    // its own recording instead. Read it out here so every exit path can settle it exactly once.
    const pron = pronRecordingRef.current;
    pronRecordingRef.current = null;
    setState("transcribing");
    try {
      let text: string;
      if (live.kind === "stream") {
        text = await live.session.stop();
      } else if (live.kind === "local") {
        text = await live.capture.stop();
      } else {
        const { blob, mime } = await live.recording.stop();
        if (onAudio && isPronunciationEnabled()) onAudio({ blob, mime });
        text = await transcribeAudio(blob, mime);
      }
      if (pron) {
        try {
          const { blob, mime } = await pron.stop();
          if (onAudio && isPronunciationEnabled()) onAudio({ blob, mime });
        } catch {
          // Aux capture failed — voice input still succeeded; just no pronunciation this turn.
        }
      }
      onTranscript(text);
    } catch (e) {
      pron?.cancel();
      if (live.kind === "stream") onTranscript("");
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setState("idle");
    }
  }

  const micDisabled = disabled || state === "transcribing";
  const label =
    state === "recording"
      ? t("stt.stopRecording")
      : providerSelected
        ? t("stt.startRecording")
        : t("stt.noProvider");

  return (
    <Button
      type="button"
      size="icon"
      variant={state === "recording" ? "default" : "ghost"}
      onClick={() => void toggle()}
      disabled={micDisabled}
      className={`size-8 rounded-full transition-transform active:scale-90${
        state === "recording" ? " animate-pulse" : ""
      }`}
      title={`${label} ${actionShortcutLabel("voice-input")}`}
      aria-label={label}
      aria-keyshortcuts={actionAriaKeyshortcuts("voice-input")}
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
