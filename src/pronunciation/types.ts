// Pronunciation assessment — the one stable contract.
// "Give the learner feedback on how they SAID a sentence" is a capability, not a prompt: it needs the
// raw audio (which a text-only LLM never sees) plus a backend that can grade speech. Two backend shapes
// exist — a dedicated phoneme-scoring API (Azure / Speechace / ELSA) and an audio-native multimodal LLM
// (Gemini audio / GPT-4o-audio) — and both collapse to `(audio, referenceText) → assessment`. So this is
// the only interface callers depend on; swapping backends = writing a second adapter, no call-site change.
// Every numeric/phoneme field is OPTIONAL so an LLM adapter (notes + per-word issues) and a dedicated API
// adapter (adds phoneme scores) satisfy the same type and the UI degrades gracefully — same "ignore unknown,
// never break" philosophy as the drill capability registry.

export interface PronunciationInput {
  /** The learner's recorded utterance. */
  audio: Blob;
  /** The recording's MIME type (e.g. audio/webm, audio/mp4); the adapter re-encodes as needed. */
  mime: string;
  /** What the learner was meant to say (shadowing target, or their own transcript for free speech). */
  referenceText: string;
  /** The language being spoken (the study target), so the assessor scores against the right phonology. */
  language: string;
  /** The learner's native language — feedback prose is written in it. */
  nativeLanguage: string;
}

export interface PronunciationPhoneme {
  ipa: string;
  /** 0–100. */
  score: number;
}

export interface PronunciationWord {
  text: string;
  /** 0–100; omitted by adapters that don't score per word. */
  score?: number;
  /** Human-readable note on what went wrong with this word (learner's native language). */
  issue?: string;
  /** Phoneme-level breakdown; only dedicated assessment APIs fill this in. */
  phonemes?: PronunciationPhoneme[];
}

export interface PronunciationAssessment {
  /** 0–100 overall accuracy; optional (an LLM may decline to score numerically). */
  overall?: number;
  /** Short coaching note in the learner's native language. */
  notes?: string;
  /** Per-word findings; an assessor may return only the words worth flagging. */
  words: PronunciationWord[];
}

export interface PronunciationAssessor {
  assess(input: PronunciationInput): Promise<PronunciationAssessment>;
}
