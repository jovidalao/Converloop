// In-band coaching hint: the conversation agent appends one final line of the
// form "[[HINT]]cue → opener" to its reply (see agents/conversation.ts). The
// trailer is private coaching content for the input box — it must never reach
// the displayed reply, TTS, or persisted history. This module strips it:
//  - splitReplyTrailer: split a complete reply into visible text + hint line
//  - createHintDeltaGate: wrap a streaming onDelta so the marker (even when it
//    arrives split across chunks) and everything after it never render

export const HINT_TRAILER_MARKER = "[[HINT]]";

// Length of the longest suffix of `text` that is a (possibly complete) prefix of
// the marker — the tail that must be held back because the next chunk might
// finish the marker.
function partialMarkerSuffixLength(text: string): number {
  const max = Math.min(text.length, HINT_TRAILER_MARKER.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(HINT_TRAILER_MARKER.slice(0, len))) return len;
  }
  return 0;
}

export function splitReplyTrailer(full: string): {
  visible: string;
  hint: string | null;
} {
  const idx = full.indexOf(HINT_TRAILER_MARKER);
  if (idx >= 0) {
    const visible = full.slice(0, idx).trimEnd();
    // The hint is the first non-empty line after the marker; anything further is
    // model overrun and dropped (the display gate swallowed it anyway).
    const rest = full.slice(idx + HINT_TRAILER_MARKER.length);
    const hint =
      rest
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? null;
    return { visible, hint };
  }
  // No full marker. An aborted stream may end mid-marker ("…[[HI"): trim that
  // partial tail so it doesn't show as stray brackets in the persisted reply.
  const partial = partialMarkerSuffixLength(full);
  const visible = partial > 0 ? full.slice(0, full.length - partial) : full;
  return { visible: visible.trimEnd(), hint: null };
}

// Streaming gate over onDelta: forwards text as it arrives, holds back any tail
// that could be the start of the marker, and once the full marker is seen stops
// forwarding entirely. The caller still accumulates the RAW stream for
// splitReplyTrailer; this gate only protects the live display.
export function createHintDeltaGate(
  onDelta: ((delta: string) => void) | undefined,
): (delta: string) => void {
  let held = ""; // tail withheld because it might begin the marker
  let gated = false; // full marker seen: swallow everything from here on
  return (delta: string) => {
    if (gated) return;
    const text = held + delta;
    const idx = text.indexOf(HINT_TRAILER_MARKER);
    if (idx >= 0) {
      gated = true;
      held = "";
      const before = text.slice(0, idx);
      if (before) onDelta?.(before);
      return;
    }
    const hold = partialMarkerSuffixLength(text);
    held = hold > 0 ? text.slice(text.length - hold) : "";
    const emit = hold > 0 ? text.slice(0, text.length - hold) : text;
    if (emit) onDelta?.(emit);
  };
}
