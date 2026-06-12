// Sentinel tags wrapping the target sentence in a say-drill reply ([[SAY]]…[[/SAY]]). The agent is
// instructed (by the code-owned output contract in render.ts) to emit the to-be-practiced sentence —
// and only that — between these tags, so the UI can hide/show it and speak it on its own while still
// showing any feedback that precedes it. Kept in one module so the agent contract and the UI parser
// share one definition. db/conversations re-exports these for existing call sites.

export const DICTATION_SAY_OPEN = "[[SAY]]";
export const DICTATION_SAY_CLOSE = "[[/SAY]]";

export interface DictationReplyParts {
  /** Feedback on the learner's previous attempt (shown). Empty on the opening turn. */
  feedback: string;
  /** The target sentence (spoken; hidden until answered in say-hidden drills). Falls back to the whole reply if the agent omits the tags. */
  sentence: string;
}

// Split a say-drill reply into the visible feedback and the target sentence. When the agent omits the
// sentinel we treat the whole reply as the sentence (so the text is never accidentally revealed), with no feedback.
export function parseDictationReply(reply: string): DictationReplyParts {
  const open = reply.indexOf(DICTATION_SAY_OPEN);
  const close = reply.indexOf(
    DICTATION_SAY_CLOSE,
    open + DICTATION_SAY_OPEN.length,
  );
  if (open >= 0 && close > open) {
    const sentence = reply
      .slice(open + DICTATION_SAY_OPEN.length, close)
      .trim();
    return { feedback: reply.slice(0, open).trim(), sentence };
  }
  return { feedback: "", sentence: reply.trim() };
}

// The portion of a still-streaming say-drill reply that is safe to show: everything before the
// sentinel begins (the feedback). Cuts at the first "[[" so a partial "[[SAY" tag never leaks the hidden sentence.
export function streamingDictationFeedback(streamed: string): string {
  const i = streamed.indexOf("[[");
  return (i >= 0 ? streamed.slice(0, i) : streamed).trim();
}
