interface RankableMasteryItem {
  key?: string | null;
  label: string;
  type?: string | null;
  status?: string | null;
  example?: string | null;
  notes?: string | null;
}

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

function tokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.normalize("NFKC").toLowerCase().matchAll(TOKEN_RE)) {
    const token = match[0];
    if (token.length < 2 && !/[\p{Script=Han}]/u.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out.slice(0, 40);
}

function haystack(item: RankableMasteryItem): {
  strong: string;
  weak: string;
} {
  return {
    strong: `${item.key ?? ""} ${item.label} ${item.type ?? ""}`
      .normalize("NFKC")
      .toLowerCase(),
    weak: `${item.example ?? ""} ${item.notes ?? ""} ${item.status ?? ""}`
      .normalize("NFKC")
      .toLowerCase(),
  };
}

function scoreItem(item: RankableMasteryItem, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const h = haystack(item);
  let score = 0;
  for (const token of queryTokens) {
    if (h.strong.includes(token)) score += 4;
    if (h.weak.includes(token)) score += 2;
  }
  const phrase = queryTokens.join(" ");
  if (phrase.length >= 4) {
    if (h.strong.includes(phrase)) score += 6;
    if (h.weak.includes(phrase)) score += 3;
  }
  return score;
}

export function rankMasteryItemsForInput<T extends RankableMasteryItem>(
  items: T[],
  userInput: string,
  context = "",
): T[] {
  const queryTokens = tokens(`${userInput}\n${context.slice(-1200)}`);
  if (queryTokens.length === 0) return items;
  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreItem(item, queryTokens),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((ranked) => ranked.item);
}
