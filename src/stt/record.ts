// Microphone capture via MediaRecorder. WKWebView (macOS 12+) and WebView2 both
// support getUserMedia once the app has OS microphone permission (macOS:
// NSMicrophoneUsageDescription in src-tauri/Info.plist). Container preference:
// mp4/aac on WebKit, webm/opus on Chromium — whisper-style endpoints accept both.
const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

export interface FinishedRecording {
  blob: Blob;
  mime: string;
}

export interface ActiveRecording {
  /** Stop and resolve with the captured audio. */
  stop(): Promise<FinishedRecording>;
  /** Stop and discard (Esc / unmount while recording). */
  cancel(): void;
}

export async function startRecording(): Promise<ActiveRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime } : undefined,
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const releaseMic = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop() {
      return new Promise<FinishedRecording>((resolve, reject) => {
        recorder.onstop = () => {
          releaseMic();
          const effectiveMime = recorder.mimeType || mime || "audio/webm";
          resolve({
            blob: new Blob(chunks, { type: effectiveMime }),
            mime: effectiveMime,
          });
        };
        recorder.onerror = () => {
          releaseMic();
          reject(new Error("Recording failed"));
        };
        recorder.stop();
      });
    },
    cancel() {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
      releaseMic();
    },
  };
}
