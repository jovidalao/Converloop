import { buildTtsCacheKey, getCachedSpeech, setCachedSpeech } from "./cache";
import {
  getMimoTtsApiKey,
  loadTtsConfig,
  MissingTtsApiKeyError,
} from "./config";
import { synthesizeEdge } from "./edge";
import { synthesizeMimo } from "./mimo";

export { clearTtsCache, getTtsCacheCount } from "./cache";
export { MissingTtsApiKeyError };

const inflight = new Map<string, Promise<ArrayBuffer>>();

export async function speakText(text: string): Promise<ArrayBuffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("没有可朗读的文本");

  const cfg = loadTtsConfig();

  // 选引擎:edge 免费无 key;mimo 需要 key。把「如何合成」收敛成一个 thunk,
  // 缓存 / 单飞去重对两种引擎共用。
  let synth: () => Promise<ArrayBuffer>;
  if (cfg.ttsProvider === "edge") {
    synth = () =>
      synthesizeEdge({
        text: trimmed,
        voice: cfg.edgeVoice,
        rate: cfg.edgeRate,
        pitch: cfg.edgePitch,
      });
  } else {
    const apiKey = await getMimoTtsApiKey();
    if (!apiKey) throw new MissingTtsApiKeyError();
    synth = () =>
      synthesizeMimo({
        apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        voice: cfg.voice,
        stylePrompt: cfg.stylePrompt,
        text: trimmed,
      });
  }

  const cacheKey = await buildTtsCacheKey(trimmed, cfg);

  const cached = await getCachedSpeech(cacheKey);
  if (cached) return cached;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = synth()
    .then(async (audio) => {
      await setCachedSpeech(cacheKey, audio);
      return audio;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });

  inflight.set(cacheKey, promise);
  return promise;
}
