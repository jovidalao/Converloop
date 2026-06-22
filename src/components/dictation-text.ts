// Sentence dictation is a plain-text exercise. Conversation replies are stored as Markdown for chat
// rendering, so remove presentation syntax before the text reaches TTS, word slots, grading, or
// translation. Keep the readable content (link labels, code text, fenced-block contents).
// A fragment shorter than this is not worth dictating on its own ("Sure!"). Such fragments are folded
// into a neighbouring sentence, or dropped only when there is no neighbour at all.
const MIN_DICTATION_WORDS = 2;
// This is a soft cap. Natural sentence boundaries win over word count; comma and colon are excluded
// because they often introduce continuation rather than a standalone listening item.
const MAX_DICTATION_WORDS = 18;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function splitLongSentence(sentence: string): string[] {
  if (wordCount(sentence) <= MAX_DICTATION_WORDS) return [sentence];
  const clauses = sentence
    .split(/(?<=[;—–])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (clauses.length <= 1) return [sentence];

  const chunks: string[] = [];
  for (const clause of clauses) {
    const last = chunks[chunks.length - 1];
    if (last && wordCount(`${last} ${clause}`) <= MAX_DICTATION_WORDS) {
      chunks[chunks.length - 1] = `${last} ${clause}`;
    } else {
      chunks.push(clause);
    }
  }
  return chunks;
}

export function segmentDictationSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed
    .split(/(?<=[.!?…。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const merged: string[] = [];
  let pending = "";
  for (const part of parts) {
    const piece = pending ? `${pending} ${part}` : part;
    pending = "";
    if (wordCount(piece) >= MIN_DICTATION_WORDS) {
      merged.push(piece);
    } else if (merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${piece}`;
    } else {
      pending = piece;
    }
  }
  if (pending && merged.length > 0) {
    merged[merged.length - 1] = `${merged[merged.length - 1]} ${pending}`;
  }
  return merged.flatMap(splitLongSentence);
}

export function toDictationPlainText(markdown: string): string {
  return markdown
    .replace(/^\s*(?:```|~~~).*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, "$1")
    .replace(/`+([^`\n]+?)`+/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/\*\*\*([\s\S]*?)\*\*\*/g, "$1")
    .replace(/___([\s\S]*?)___/g, "$1")
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/~~([\s\S]*?)~~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/\\([\\`*_[\]{}()#+.!>-])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
