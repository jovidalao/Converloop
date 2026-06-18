import { getProvider, loadConfig } from "../config";

// Native-language prompt for the by-meaning dictation mode: the learner reads this and reproduces the
// original target sentence. Most cached lines have no stored translation, so we translate them on
// demand and cache the result — keyed by language pair + sentence — so a sentence always shows the
// same prompt and repeats are instant (and survive restarts). Expression-gap lines never reach here:
// their native source is already on the ListeningItem (see tts/listening.ts).

// Thrown when no LLM provider is configured — the view maps this to a friendly, localized message.
export const NO_PROVIDER = "no-provider";

const memo = new Map<string, string>();
const LS_KEY = "lang-agent.dictation-translations";

function loadStore(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function persist(key: string, value: string) {
  try {
    const store = loadStore();
    store[key] = value;
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    // A full/blocked localStorage just means we re-translate next session — not worth surfacing.
  }
}

export async function translateForPrompt(sentence: string): Promise<string> {
  const text = sentence.trim();
  if (!text) return "";
  const cfg = loadConfig();
  const key = `${cfg.targetLanguage}»${cfg.nativeLanguage}»${text}`;

  const cached = memo.get(key) ?? loadStore()[key];
  if (cached) {
    memo.set(key, cached);
    return cached;
  }

  const provider = await getProvider();
  if (!provider) throw new Error(NO_PROVIDER);

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
  persist(key, clean);
  return clean;
}
