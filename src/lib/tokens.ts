// Rough token estimation (pure logic, unit-testable; no DB/Tauri/tokenizer).
// Purpose: determine whether "the full prompt for the next turn" is approaching the context limit, triggering auto-compression (see summary-runner).
// Deliberately no real tokenizer: in BYOK mode the model is unknown, tokenizers are inaccurate for non-target models, and they add unnecessary bundle size.
// Estimation errors are fine — the 70% high-water mark already leaves 30% headroom; deviations are absorbed by that buffer.
//
// Heuristic: CJK characters at ~1 token/char (tokenizers typically use 1–2 tokens per Chinese character; taking 1 is slightly aggressive = compress earlier, which is safe);
// everything else (Latin letters/spaces/punctuation) at ~4 chars/token (consistent with the TRANSCRIPT_CHAR_BUDGET assumption in the maintainer agent).
// Prefer over-estimating: under-estimating can genuinely blow the context and cause errors; over-estimating just compresses slightly earlier.

// CJK Unified Ideographs + Extension A + Compatibility + Kana + Hangul, covering common CJK characters.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

// Aggregate token estimates for a set of message texts. Each message gets a small fixed overhead (role/delimiter), roughly aligning with the actual protocol.
const PER_MESSAGE_OVERHEAD = 4;

export function estimatePromptTokens(parts: string[]): number {
  return parts.reduce(
    (sum, p) => sum + estimateTokens(p) + PER_MESSAGE_OVERHEAD,
    0,
  );
}
