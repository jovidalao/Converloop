import { pinyin } from "pinyin-pro";
import { languageToBcp47, segmentWords } from "./lib/language";

export interface ReadingSegment {
  text: string;
  reading?: string;
}

const HAN_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;

const JAPANESE_READINGS = [
  ["日本語", "にほんご"],
  ["中国語", "ちゅうごくご"],
  ["韓国語", "かんこくご"],
  ["今日", "きょう"],
  ["明日", "あした"],
  ["昨日", "きのう"],
  ["日本", "にほん"],
  ["勉強", "べんきょう"],
  ["学校", "がっこう"],
  ["先生", "せんせい"],
  ["学生", "がくせい"],
  ["友達", "ともだち"],
  ["仕事", "しごと"],
  ["時間", "じかん"],
  ["映画", "えいが"],
  ["音楽", "おんがく"],
  ["料理", "りょうり"],
  ["旅行", "りょこう"],
  ["電車", "でんしゃ"],
  ["言葉", "ことば"],
  ["会話", "かいわ"],
  ["練習", "れんしゅう"],
  ["質問", "しつもん"],
  ["問題", "もんだい"],
  ["意味", "いみ"],
  ["発音", "はつおん"],
  ["大丈夫", "だいじょうぶ"],
  ["好き", "すき"],
  ["私", "わたし"],
  ["僕", "ぼく"],
  ["彼女", "かのじょ"],
  ["彼", "かれ"],
  ["行く", "いく"],
  ["来る", "くる"],
  ["食べる", "たべる"],
  ["飲む", "のむ"],
  ["見る", "みる"],
  ["聞く", "きく"],
  ["話す", "はなす"],
  ["読む", "よむ"],
  ["書く", "かく"],
] as const;

const JAPANESE_LEXICON = [...JAPANESE_READINGS].sort(
  ([a], [b]) => b.length - a.length,
);

export function supportsReadingGuide(language: string): boolean {
  const tag = languageToBcp47(language);
  return tag === "zh" || tag === "ja";
}

function pushPlain(out: ReadingSegment[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && !last.reading) {
    last.text += text;
  } else {
    out.push({ text });
  }
}

function pinyinFor(text: string): string {
  return pinyin(text, { type: "array" }).join(" ").trim();
}

function annotateChineseRun(text: string): ReadingSegment[] {
  const words = segmentWords(text, "zh");
  const tokens = words.length > 0 ? words : [...text];
  return tokens.map((token) => {
    const reading = pinyinFor(token);
    return reading && reading !== token
      ? { text: token, reading }
      : { text: token };
  });
}

function annotateChinese(text: string): ReadingSegment[] {
  const out: ReadingSegment[] = [];
  let last = 0;
  HAN_RUN.lastIndex = 0;
  for (let m = HAN_RUN.exec(text); m !== null; m = HAN_RUN.exec(text)) {
    if (m.index > last) pushPlain(out, text.slice(last, m.index));
    out.push(...annotateChineseRun(m[0]));
    last = HAN_RUN.lastIndex;
  }
  if (last < text.length) pushPlain(out, text.slice(last));
  return out;
}

function annotateJapanese(text: string): ReadingSegment[] {
  const out: ReadingSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = JAPANESE_LEXICON.find(([word]) => text.startsWith(word, i));
    if (hit) {
      out.push({ text: hit[0], reading: hit[1] });
      i += hit[0].length;
    } else {
      pushPlain(out, text[i]);
      i += 1;
    }
  }
  return out;
}

export function readingGuideSegments(
  text: string,
  language: string,
): ReadingSegment[] {
  const tag = languageToBcp47(language);
  if (tag === "zh") return annotateChinese(text);
  if (tag === "ja") return annotateJapanese(text);
  return [{ text }];
}
