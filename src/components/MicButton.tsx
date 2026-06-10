import { MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { loadSttConfig, MissingSttApiKeyError } from "../stt/config";
import { type ParakeetCapture, startParakeetCapture } from "../stt/local";
import { type StreamingSession, startSonioxStream } from "../stt/realtime";
import { type ActiveRecording, startRecording } from "../stt/record";
import { transcribeAudio } from "../stt/transcribe";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// Composer voice input,按 STT 引擎分三条路:
//  - Soniox(stream):实时流式,说话时 onPartial 持续把「已定 + 暂定」文本推给输入框,
//    停止后以 onTranscript(最终文本) 收尾;
//  - OpenAI 兼容(batch):录完整段 → 上传转写 → onTranscript;
//  - Parakeet(local):录完整段 → 本地 sherpa-onnx 转写 → onTranscript(无流式)。
// 约定:流式会话一旦推过 onPartial,必以一次 onTranscript 收尾(取消/出错时
// 传 ""),调用方据此回滚或落定文本。学习者发送前还要确认文本——这个确认
// 本身就是学习环节的一部分。Esc 取消录音。
type LiveSession =
  | { kind: "stream"; session: StreamingSession }
  | { kind: "batch"; recording: ActiveRecording }
  | { kind: "local"; capture: ParakeetCapture };

export function MicButton({
  disabled = false,
  onTranscript,
  onPartial,
  onError,
}: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onPartial: (text: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const sessionRef = useRef<LiveSession | null>(null);

  // Discard any live recording on unmount (conversation switch etc.).
  useEffect(() => {
    return () => {
      const live = sessionRef.current;
      sessionRef.current = null;
      if (live?.kind === "stream") live.session.cancel();
      else if (live?.kind === "batch") live.recording.cancel();
      else if (live?.kind === "local") live.capture.cancel();
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
          onTranscript(""); // 回滚已经流进输入框的暂定文本
        } else if (live?.kind === "batch") {
          live.recording.cancel();
        } else if (live?.kind === "local") {
          live.capture.cancel();
        }
        setState("idle");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, onTranscript]);

  async function toggle() {
    if (disabled || state === "transcribing") return;
    if (state === "idle") {
      try {
        const provider = loadSttConfig().sttProvider;
        if (provider === "soniox") {
          const session = await startSonioxStream({
            onPartial,
            onError: (e) => {
              // 录音途中连接挂掉:会话已自清理,回滚暂定文本并复位。
              sessionRef.current = null;
              setState("idle");
              onTranscript("");
              onError(e.message);
            },
          });
          sessionRef.current = { kind: "stream", session };
        } else if (provider === "parakeet") {
          sessionRef.current = {
            kind: "local",
            capture: await startParakeetCapture(),
          };
        } else {
          sessionRef.current = {
            kind: "batch",
            recording: await startRecording(),
          };
        }
        setState("recording");
      } catch (e) {
        onError(
          e instanceof MissingSttApiKeyError ? e.message : t("stt.micDenied"),
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
    setState("transcribing");
    try {
      let text: string;
      if (live.kind === "stream") {
        text = await live.session.stop();
      } else if (live.kind === "local") {
        text = await live.capture.stop();
      } else {
        const { blob, mime } = await live.recording.stop();
        text = await transcribeAudio(blob, mime);
      }
      onTranscript(text);
    } catch (e) {
      if (live.kind === "stream") onTranscript("");
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
