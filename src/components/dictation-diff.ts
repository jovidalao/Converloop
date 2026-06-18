// Local, offline check for the sentence-dictation view: the target sentence is known (it is the
// cached line being replayed), so we grade the typed answer by comparing it to that sentence directly
// — no LLM call. Comparison is case- and punctuation-insensitive; the per-word hit/miss flags drive the
// reveal highlighting, while `correct` is the strict "did you transcribe the whole thing" verdict.

export type DictationTokenStatus = "hit" | "miss";

export interface DictationToken {
  /** The expected word exactly as written (original case + punctuation), for display. */
  text: string;
  status: DictationTokenStatus;
}

export interface DictationResult {
  /** Normalized answer matches the normalized target word-for-word (order included). */
  correct: boolean;
  /** The target sentence split into display words, each marked hit (you got it) or miss (you didn't). */
  expectedTokens: DictationToken[];
}

// Lowercase and drop every non-alphanumeric mark. This is deliberately lenient: apostrophes, hyphens
// and end punctuation aren't audible, so "don't" matches "dont" and "today." matches "today" — what
// matters in a listening drill is whether you heard the word. Returns "" for pure-punctuation tokens
// (e.g. a lone "—"), which are then never counted as a miss.
function normalize(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

// Longest-common-subsequence alignment: returns the set of indices in `a` that participate in the LCS
// with `b`. Used to mark which expected words the learner's answer actually covered (in order).
function lcsMatchedIndices(a: string[], b: string[]): Set<number> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matched.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return matched;
}

// Grade a dictation attempt against the known target sentence.
export function checkDictation(
  expected: string,
  actual: string,
): DictationResult {
  const displayWords = words(expected);

  // Expected words that carry meaning (drop pure punctuation), paired with their display index.
  const realExpected: { norm: string; displayIndex: number }[] = [];
  displayWords.forEach((w, idx) => {
    const norm = normalize(w);
    if (norm) realExpected.push({ norm, displayIndex: idx });
  });

  const actualNorm = words(actual).map(normalize).filter(Boolean);
  const expectedNorm = realExpected.map((e) => e.norm);

  const matched = lcsMatchedIndices(expectedNorm, actualNorm);
  const matchedDisplay = new Set<number>();
  for (const k of matched) matchedDisplay.add(realExpected[k].displayIndex);

  const expectedTokens: DictationToken[] = displayWords.map((w, idx) => ({
    text: w,
    // Punctuation-only tokens aren't gradable, so they never count as a miss.
    status: normalize(w) === "" || matchedDisplay.has(idx) ? "hit" : "miss",
  }));

  const correct = expectedNorm.join(" ") === actualNorm.join(" ");
  return { correct, expectedTokens };
}
