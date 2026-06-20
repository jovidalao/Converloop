// Sentence dictation is a plain-text exercise. Conversation replies are stored as Markdown for chat
// rendering, so remove presentation syntax before the text reaches TTS, word slots, grading, or
// translation. Keep the readable content (link labels, code text, fenced-block contents).
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
