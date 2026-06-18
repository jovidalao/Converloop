import { loadConfig } from "../config";
import {
  getSttApiKey,
  languageHintsFor,
  loadSttConfig,
  MissingSttApiKeyError,
} from "./config";

// Soniox real-time transcription: the webview connects directly over WebSocket
// (no CORS for WS, CSP connect-src already allows it), without Rust. Audio is
// captured as s16le PCM by the AudioWorklet in public/pcm-worklet.js and pushed
// upstream. Tokens stream into onPartial; after stop, the server flushes the
// remaining tokens into the final transcript. Language hints match the batch
// path: native + target language, with automatic language identification still on.
const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
/** Max wait after the end frame for the server to flush trailing tokens. */
const FINALIZE_TIMEOUT_MS = 10_000;

interface SonioxToken {
  text: string;
  is_final?: boolean;
}

interface SonioxMessage {
  tokens?: SonioxToken[];
  error_code?: number;
  error_message?: string;
  finished?: boolean;
}

export interface StreamingSession {
  /** Stop capture and resolve with the final transcript after server flush. */
  stop(): Promise<string>;
  /** Stop and discard (Esc / unmount). */
  cancel(): void;
}

export async function startSonioxStream(handlers: {
  /** Full transcript so far (final + tentative tokens), called repeatedly. */
  onPartial: (text: string) => void;
  /** Capture-time failure; the session has already cleaned itself up. */
  onError: (error: Error) => void;
}): Promise<StreamingSession> {
  const sttConfig = loadSttConfig();
  const apiKey = await getSttApiKey("soniox");
  if (!apiKey) throw new MissingSttApiKeyError();
  const app = loadConfig();
  const hints = languageHintsFor([app.targetLanguage, app.nativeLanguage]);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const releaseMic = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  const ctx = new AudioContext();
  // stop -> teardown can close twice; ignore the second rejection on a closed ctx.
  const closeCtx = () => {
    ctx.close().catch(() => {});
  };
  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
  } catch (e) {
    releaseMic();
    closeCtx();
    throw e instanceof Error ? e : new Error(String(e));
  }
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, "pcm-capture");
  // Older WebKit may not run detached nodes. Route through a zero-gain output as
  // a fallback without playing audio.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(capture);
  capture.connect(mute);
  mute.connect(ctx.destination);
  void ctx.resume();

  let finalText = "";
  let pendingText = "";
  let settled = false;
  let stopping = false;
  let finishResolve: ((text: string) => void) | null = null;
  let finishReject: ((error: Error) => void) | null = null;
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  // The worklet can start before the WS handshake; queue frames until open.
  const preOpenQueue: ArrayBuffer[] = [];
  let wsReady = false;

  const ws = new WebSocket(SONIOX_WS_URL);

  const teardown = () => {
    settled = true;
    if (finalizeTimer) clearTimeout(finalizeTimer);
    capture.port.onmessage = null;
    releaseMic();
    closeCtx();
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
  };

  const finish = () => {
    const text = (finalText + pendingText).trim();
    const resolve = finishResolve;
    finishResolve = null;
    finishReject = null;
    teardown();
    resolve?.(text);
  };

  // During recording, report via onError; while stop() is waiting, reject its
  // promise so callers do not hang.
  const fail = (error: Error) => {
    if (settled) return;
    const reject = finishReject;
    finishResolve = null;
    finishReject = null;
    teardown();
    if (reject) reject(error);
    else handlers.onError(error);
  };

  capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (settled || stopping) return;
    if (wsReady && ws.readyState === WebSocket.OPEN) ws.send(e.data);
    else if (!wsReady) preOpenQueue.push(e.data);
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        api_key: apiKey,
        model: sttConfig.sonioxModel,
        audio_format: "pcm_s16le",
        sample_rate: ctx.sampleRate,
        num_channels: 1,
        enable_language_identification: true,
        ...(hints.length > 0 ? { language_hints: hints } : {}),
      }),
    );
    wsReady = true;
    for (const chunk of preOpenQueue) ws.send(chunk);
    preOpenQueue.length = 0;
    if (stopping) ws.send("");
  };

  ws.onmessage = (e: MessageEvent<string>) => {
    if (settled) return;
    let msg: SonioxMessage;
    try {
      msg = JSON.parse(e.data) as SonioxMessage;
    } catch {
      return;
    }
    if (msg.error_code) {
      fail(new Error(`Soniox ${msg.error_code}: ${msg.error_message ?? ""}`));
      return;
    }
    if (msg.tokens && msg.tokens.length > 0) {
      let tentative = "";
      for (const token of msg.tokens) {
        // Control tokens such as <end>/<fin> are not transcript text.
        if (token.text.startsWith("<")) continue;
        if (token.is_final) finalText += token.text;
        else tentative += token.text;
      }
      pendingText = tentative;
      handlers.onPartial(finalText + pendingText);
    }
    if (msg.finished) finish();
  };

  ws.onerror = () => fail(new Error("Soniox connection failed"));
  ws.onclose = () => {
    if (settled) return;
    // During stop, the server closes after sending finished. If it closes early,
    // fall back to the text we have; during recording, treat it as an error.
    if (stopping) finish();
    else fail(new Error("Soniox connection closed"));
  };

  return {
    stop() {
      return new Promise<string>((resolve, reject) => {
        if (settled) {
          resolve((finalText + pendingText).trim());
          return;
        }
        stopping = true;
        finishResolve = resolve;
        finishReject = reject;
        releaseMic();
        closeCtx();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(""); // End frame: ask the server to flush and send finished.
        } else if (ws.readyState !== WebSocket.CONNECTING) {
          finish();
          return;
        }
        finalizeTimer = setTimeout(finish, FINALIZE_TIMEOUT_MS);
      });
    },
    cancel() {
      teardown();
    },
  };
}
