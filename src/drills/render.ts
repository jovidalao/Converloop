// Renders a drill's per-turn instruction block from its definition + session params + per-turn extras.
// The document's # Task prose is the user-editable part; the say output contract, the review-items
// list formatting, the listening-words feed and the pacing/replay note are owned by app code and
// appended here based on the frontmatter enums — a document can never break the [[SAY]] parser or
// invent its own bookkeeping.

import { DICTATION_SAY_CLOSE, DICTATION_SAY_OPEN } from "./say";
import type { DrillDefinition, DrillParams, ReviewDrillItem } from "./types";

export interface DrillRenderExtras {
  /** Languages for the {{native_language}} / {{target_language}} / {{level}} template variables. */
  nativeLanguage?: string;
  targetLanguage?: string;
  level?: string;
  /** feed: listening-words — tracked listening-weak words to weave into upcoming sentences. */
  listeningFocusWords?: string[];
  /** say drills — replays of the previous sentence (incl. slow replays), a live difficulty signal. */
  replayNote?: string;
}

// Collapse whitespace and truncate, so long stored examples don't bloat the drill instructions.
function oneLine(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

export function formatReviewItemsList(items: ReviewDrillItem[]): string {
  return items
    .map((item, i) => {
      const details = [
        item.example ? `it came up as "${oneLine(item.example)}"` : null,
        item.notes ? `note: "${oneLine(item.notes)}"` : null,
      ].filter(Boolean);
      return `    ${i + 1}. [${item.type}] ${item.label} (${item.key})${
        details.length ? ` — ${details.join("; ")}` : ""
      }`;
    })
    .join("\n");
}

function substituteVars(
  text: string,
  params: DrillParams,
  extras: DrillRenderExtras,
): string {
  const vars: Record<string, string> = {
    setup: params.setup?.trim() || "everyday life",
    items: formatReviewItemsList(params.items ?? []),
    native_language: extras.nativeLanguage ?? "the learner's native language",
    target_language: extras.targetLanguage ?? "the target language",
    level: extras.level ?? "the learner's level",
  };
  return text.replace(
    /\{\{(setup|items|native_language|target_language|level)\}\}/g,
    (_, key: string) => vars[key],
  );
}

// The say output contract (code-owned). `hidden` adds the no-spoiler rule for dictation-style drills
// where the UI masks the sentence until it is answered.
function sayContract(hidden: boolean): string {
  return `STRICT OUTPUT FORMAT — follow it on EVERY turn:
  • If the learner just submitted an attempt, FIRST give your brief feedback note as instructed above. Keep it short.
  • THEN, as the LAST thing in your message, output the next sentence wrapped EXACTLY as: ${DICTATION_SAY_OPEN}the sentence${DICTATION_SAY_CLOSE} with nothing after the closing tag.
The text inside ${DICTATION_SAY_OPEN}…${DICTATION_SAY_CLOSE} MUST be a single, complete, natural sentence in the TARGET language, calibrated to the learner's level. Put ONLY that sentence between the tags.${
    hidden
      ? " NEVER write the upcoming sentence anywhere except inside the tags, and never describe it in advance."
      : ""
  }`;
}

function listeningFocusBlock(words: string[]): string {
  const clean = words.map((w) => w.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  return `LISTENING REVIEW — the learner previously missed these words by ear: ${clean
    .map((w) => `"${w}"`)
    .join(
      ", ",
    )}. Where it fits the theme naturally, build upcoming sentences so ONE of these words reappears (at most one per sentence) — that re-exposure is how listening review happens. Never announce that a word is a review word.`;
}

/** One indented "- …" block appended to the conversation agent's SESSION ADJUSTMENTS. */
export function renderDrillInstructions(
  def: DrillDefinition,
  params: DrillParams,
  extras: DrillRenderExtras = {},
): string {
  const parts: string[] = [substituteVars(def.task.trim(), params, extras)];
  if (def.interaction !== "chat") {
    parts.push(sayContract(def.interaction === "say-hidden"));
  }
  if (def.feed === "listening-words" && extras.listeningFocusWords) {
    const block = listeningFocusBlock(extras.listeningFocusWords);
    if (block) parts.push(block);
  }
  if (extras.replayNote?.trim()) parts.push(extras.replayNote.trim());

  // Same list shape as the other session adjustments: first line "- …", continuations indented.
  const lines = parts.join("\n").split("\n");
  return lines
    .map((line, i) => (i === 0 ? `- ${line}` : `  ${line}`))
    .join("\n");
}

/** Kickoff instruction for the AI's first turn. Say drills get the wrapping requirement appended by
 *  code (the document body itself is not allowed to contain the [[SAY]] tags). */
export function renderDrillOpening(
  def: DrillDefinition,
  params: DrillParams,
  extras: DrillRenderExtras = {},
): string {
  const opening = substituteVars(def.opening.trim(), params, extras);
  if (def.interaction === "chat") return opening;
  return `${opening} Wrap the sentence exactly as ${DICTATION_SAY_OPEN}the sentence${DICTATION_SAY_CLOSE}, with nothing before or after the tags.`;
}
