import { buildTtsCacheKey, getCachedSpeech, setCachedSpeech } from "./cache";
import {
  getMimoTtsApiKey,
  loadTtsConfig,
  MissingTtsApiKeyError,
} from "./config";
import { synthesizeMimo } from "./mimo";

export { clearTtsCache, getTtsCacheCount } from "./cache";
export { MissingTtsApiKeyError };

const inflight = new Map<string, Promise<ArrayBuffer>>();

export async function speakText(text: string): Promise<ArrayBuffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("没有可朗读的文本");

  const apiKey = await getMimoTtsApiKey();
  if (!apiKey) throw new MissingTtsApiKeyError();

  const cfg = loadTtsConfig();
  const cacheKey = await buildTtsCacheKey(trimmed, cfg);

  const cached = await getCachedSpeech(cacheKey);
  if (cached) return cached;

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = synthesizeMimo({
    apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    voice: cfg.voice,
    stylePrompt: cfg.stylePrompt,
    text: trimmed,
  })
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
