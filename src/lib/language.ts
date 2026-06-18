// Map a study-language name (the STUDY_LANGUAGES value, a BCP-47 code, or a common native form the user
// might type) to a BCP-47 base tag. Used to pick a default TTS voice and a word-segmenter locale.
// Returns "" when the language is unknown, so callers can fall back.

const CODES = [
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "ru",
  "it",
  "ar",
  "hi",
  "tr",
  "vi",
  "id",
  "bn",
  "pl",
  "th",
  "uk",
];

const LANGUAGE_TAGS: { tag: string; test: RegExp }[] = [
  {
    tag: "zh",
    test: /chinese|simplified chinese|traditional chinese|mandarin|cantonese|中文|简体中文|簡體中文|繁体中文|繁體中文|汉语|漢語|普通话|普通話|粤语/i,
  },
  { tag: "ar", test: /arabic|العربية|阿拉伯语|阿拉伯文/i },
  { tag: "hi", test: /hindi|हिन्दी|हिंदी|印地语|印地文/i },
  { tag: "ja", test: /japanese|日本語|日语|日文/i },
  { tag: "ko", test: /korean|한국어|韩语|韓語|韩文/i },
  { tag: "es", test: /spanish|español|espanol|西班牙语|西语/i },
  { tag: "fr", test: /french|français|francais|法语|法文/i },
  { tag: "de", test: /german|deutsch|德语|德文/i },
  { tag: "pt", test: /portuguese|português|portugues|葡萄牙语|葡语/i },
  { tag: "ru", test: /russian|русск|俄语|俄文/i },
  { tag: "tr", test: /turkish|türkçe|turkce|土耳其语|土耳其文/i },
  { tag: "vi", test: /vietnamese|tiếng việt|tieng viet|越南语|越南文/i },
  {
    tag: "id",
    test: /indonesian|bahasa indonesia|印尼语|印度尼西亚语|印尼文/i,
  },
  { tag: "bn", test: /bengali|bangla|বাংলা|孟加拉语|孟加拉文/i },
  { tag: "pl", test: /polish|polski|波兰语|波兰文/i },
  { tag: "it", test: /italian|italiano|意大利语|意语/i },
  { tag: "th", test: /thai|ภาษาไทย|泰语|泰文/i },
  { tag: "uk", test: /ukrainian|українська|乌克兰语|乌克兰文/i },
  // English last so its short forms don't shadow another language's name.
  { tag: "en", test: /english|英语|英文/i },
];

export function languageToBcp47(name: string): string {
  const s = name.trim().toLowerCase();
  if (!s) return "";
  if (CODES.includes(s)) return s;
  for (const { tag, test } of LANGUAGE_TAGS) if (test.test(s)) return tag;
  return "";
}

// Minimal typing for Intl.Segmenter (not in the project's ES2020 lib). Runtime support exists in both
// WebKit (macOS WebView) and WebView2 (Windows), and in Node for tests; we feature-detect before use.
interface SegmenterCtor {
  new (
    locales?: string,
    options?: { granularity?: "grapheme" | "word" | "sentence" },
  ): {
    segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
  };
}

// Word-like tokens via dictionary segmentation. Needed for scripts without spaces (Han/Kana): a regex
// split would treat a whole run of characters as a single token. Returns [] if Intl.Segmenter is missing.
export function segmentWords(text: string, locale: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!Seg) return [];
  const seg = new Seg(locale || "und", { granularity: "word" });
  return [...seg.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment.trim())
    .filter(Boolean);
}
