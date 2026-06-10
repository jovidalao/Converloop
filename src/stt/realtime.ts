import { loadConfig } from "../config";
import {
  getSttApiKey,
  languageHintsFor,
  loadSttConfig,
  MissingSttApiKeyError,
} from "./config";

// Soniox 实时流式转写:WebSocket 直连(WS 无 CORS,CSP connect-src 已放行),
// 不走 Rust。音频经 AudioWorklet(public/pcm-worklet.js)采成 s16le PCM 推流,
// token 边到边回调 onPartial;停止后服务端 flush 余下 token 再给最终文本。
// 语言提示同批量路径:母语 + 目标语,混说仍开自动语言识别。
const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
/** 发送结束帧后等服务端吐完尾部 token 的上限。 */
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
  /** 停止采音,等服务端 flush 后给出最终文本。 */
  stop(): Promise<string>;
  /** 停止并丢弃(Esc / 卸载时)。 */
  cancel(): void;
}

export async function startSonioxStream(handlers: {
  /** 截至目前的完整转写(已定 + 暂定 token),随流式更新反复触发。 */
  onPartial: (text: string) => void;
  /** 录音途中的失败(连接断开、服务端报错);触发后会话已自行清理。 */
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
  // stop → teardown 会经过两次 close,第二次在已关闭的 ctx 上 reject,吞掉。
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
  // 旧 WebKit 对悬空节点可能不跑图:经 0 增益接到输出兜底,不会外放。
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
  // worklet 起得比 WS 握手快,先攒着,open 后补发。
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

  // 录音途中报 onError;stop() 等待期间改为 reject 它的 promise,免得调用方挂死。
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
        // <end>/<fin> 等控制 token 不进文本。
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
    // 停止流程里服务端发完 finished 就关连接;没收到 finished 的提前断开按
    // 已有文本兜底,录音途中断开则报错。
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
          ws.send(""); // 结束帧:让服务端 flush 并回 finished
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
