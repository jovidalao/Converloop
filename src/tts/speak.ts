import { loadConfig } from "../config";
import { buildTtsCacheKey, getCachedSpeech, setCachedSpeech } from "./cache";
import {
  defaultEdgeVoiceForLanguage,
  EDGE_AUTO_VOICE,
  getMimoTtsApiKey,
  loadTtsConfig,
  MissingTtsApiKeyError,
} from "./config";
import { synthesizeEdge } from "./edge";
import { synthesizeMimo } from "./mimo";

export { clearTtsCache, getTtsCacheCount } from "./cache";
export { MissingTtsApiKeyError };

const inflight = new Map<string, Promise<ArrayBuffer>>();

export async function speakText(
  text: string,
  opts: { voice?: string } = {},
): Promise<ArrayBuffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("No text to speak");

  const base = loadTtsConfig();
  // Per-call voice override (the listening page sets distinct voices for learner vs AI lines).
  // Fold it into the active provider's voice field so BOTH synthesis and the cache key reflect it:
  // a different voice yields a different cache key, so audio is re-synthesized once for that voice
  // and then served from cache; the same voice hits whatever was cached while chatting.
  const withOverride =
    opts.voice && opts.voice !== ""
      ? base.ttsProvider === "edge"
        ? { ...base, edgeVoice: opts.voice }
        : { ...base, voice: opts.voice }
      : base;

  // Resolve the "auto" Edge voice to a concrete voice for the current learning language. Done here (not at
  // synthesis) so the cache key reflects the real voice — otherwise every language would share one "auto"
  // cache entry. loadConfig() only runs in the auto case, keeping the common path lean.
  const cfg =
    withOverride.ttsProvider === "edge" &&
    withOverride.edgeVoice === EDGE_AUTO_VOICE
      ? {
          ...withOverride,
          edgeVoice: defaultEdgeVoiceForLanguage(loadConfig().targetLanguage),
        }
      : withOverride;

  // Choose engine: edge is free with no key; mimo requires a key. Collapse "how to synthesize" into a single thunk
  // so caching / single-flight deduplication is shared by both engines.
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
