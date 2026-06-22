import { getProvider, loadConfig } from "../config";
import { getAppState, setAppState } from "../db/app-state";

// Native-language prompt for the by-meaning dictation mode: the learner reads this and reproduces the
// original target sentence. Most cached lines have no stored translation, so we translate them on
// demand and cache the result — keyed by language pair + sentence — so a sentence always shows the
// same prompt and repeats are instant (and survive restarts/backups). Expression-gap lines never reach
// here: their native source is already on the ListeningItem (see tts/listening.ts).

// Thrown when no LLM provider is configured — the view maps this to a friendly, localized message.
export const NO_PROVIDER = "no-provider";

export const DICTATION_TRANSLATIONS_STATE_KEY =
  "dictation-review:translations:v1";

const memo = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();
const LEGACY_LS_KEY = "lang-agent.dictation-translations";
let store: Record<string, string> | null = null;
let storePromise: Promise<Record<string, string>> | null = null;

function loadLegacyStore(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function removeLegacyStore() {
  try {
    globalThis.localStorage?.removeItem(LEGACY_LS_KEY);
  } catch {
    // Best-effort cleanup only; keeping the legacy copy is harmless.
  }
}

function parseStore(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

async function loadStore(): Promise<Record<string, string>> {
  let persisted: Record<string, string> = {};
  let canPersist = true;
  try {
    persisted = parseStore(await getAppState(DICTATION_TRANSLATIONS_STATE_KEY));
  } catch {
    canPersist = false;
  }

  const legacy = loadLegacyStore();
  const merged = { ...legacy, ...persisted };
  if (
    canPersist &&
    Object.keys(legacy).some((key) => persisted[key] !== legacy[key])
  ) {
    try {
      await setAppState(
        DICTATION_TRANSLATIONS_STATE_KEY,
        JSON.stringify(merged),
      );
      removeLegacyStore();
    } catch {
      // If SQLite is unavailable, keep using the in-memory merge this session.
    }
  }

  return merged;
}

async function ensureStore(): Promise<Record<string, string>> {
  if (store) return store;
  if (!storePromise) storePromise = loadStore();
  store = await storePromise;
  storePromise = null;
  return store;
}

async function persist(key: string, value: string): Promise<void> {
  const current = await ensureStore();
  if (current[key] === value) return;
  current[key] = value;
  try {
    await setAppState(
      DICTATION_TRANSLATIONS_STATE_KEY,
      JSON.stringify(current),
    );
  } catch {
    // A missing/blocked DB just means we re-translate next session — not worth surfacing.
  }
}

function translationKey(text: string): string {
  const cfg = loadConfig();
  return `${cfg.targetLanguage}»${cfg.nativeLanguage}»${text}`;
}

async function generateTranslation(key: string, text: string): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new Error(NO_PROVIDER);
  const cfg = loadConfig();

  const raw = await provider.generate({
    messages: [
      {
        role: "system",
        content: `Translate the ${cfg.targetLanguage} sentence the user sends into ${cfg.nativeLanguage}. Output ONLY the ${cfg.nativeLanguage} translation as a single line — no quotes, no notes, no romanization, no original text.`,
      },
      { role: "user", content: text },
    ],
    temperature: 0.2,
    meta: { label: "dictation-translate" },
  });

  // Strip a wrapping pair of quotes the model sometimes adds around the lone sentence.
  const clean = raw
    .trim()
    .replace(/^["“”'']+|["“”'']+$/g, "")
    .trim();
  memo.set(key, clean);
  await persist(key, clean);
  return clean;
}

export async function translateForPrompt(sentence: string): Promise<string> {
  const text = sentence.trim();
  if (!text) return "";
  const key = translationKey(text);

  const cachedMemo = memo.get(key);
  if (cachedMemo) return cachedMemo;
  const cachedStore = (await ensureStore())[key];
  if (cachedStore) {
    memo.set(key, cachedStore);
    return cachedStore;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = generateTranslation(key, text).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export async function prefetchPromptTranslations(
  sentences: string[],
  concurrency = 2,
): Promise<void> {
  const queue = [...new Set(sentences.map((s) => s.trim()).filter(Boolean))];
  let index = 0;
  let noProvider = false;
  async function worker() {
    while (!noProvider && index < queue.length) {
      const sentence = queue[index++];
      try {
        await translateForPrompt(sentence);
      } catch (e) {
        if (e instanceof Error && e.message === NO_PROVIDER) noProvider = true;
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), queue.length) },
      () => worker(),
    ),
  );
}
