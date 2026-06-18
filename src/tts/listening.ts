import type { TutorAnalysis } from "../agents/schema";
import {
  type ConversationMeta,
  parseAgentModifiers,
  parseDictationReply,
} from "../db/conversations";
import type { ChatTurn } from "../db/turns";

export type ListeningSide = "user" | "ai";

// One playable line in a listening playlist. `text` is the EXACT string the chat
// side synthesizes for this line, so its audio is served from the same IndexedDB
// TTS cache (no re-synthesis) — see src/tts/speak.ts / src/tts/stream.ts.
export interface ListeningItem {
  /** Stable unique id (`${turnId}:${side}`), also used as the playback key. */
  id: string;
  conversationId: string;
  turnId: string;
  side: ListeningSide;
  text: string;
  /** Native-language meaning of `text`, when already known (an expression-gap source). The by-meaning
   *  dictation mode shows it as the prompt; items without one are translated on demand. */
  nativePrompt?: string;
}

function makeItem(
  conversationId: string,
  turnId: string,
  side: ListeningSide,
  text: string,
  nativePrompt?: string,
): ListeningItem {
  return {
    id: `${turnId}:${side}`,
    conversationId,
    turnId,
    side,
    text,
    nativePrompt,
  };
}

// The native-language prompt for the learner's idiomatic line, when it came from an expression gap
// (native/mixed input): `original` is what they were trying to say — the natural thing to reproduce
// the idiomatic sentence from. Absent for plain target-language turns — those get translated on demand.
function userNativePrompt(analysis: TutorAnalysis | null): string | undefined {
  const eg = analysis?.expression_gap;
  if (!eg) return undefined;
  return eg.original.trim() || undefined;
}

// The idiomatic target-language version of the learner's own message — mirrors the speak
// target on the user bubble in chat (turns.tsx), so its cached audio is reused:
//   • expression-gap turns (native/mixed input) → the idiomatic target sentence
//   • otherwise → the "more natural" rewrite when it differs from the correction, else the correction
// Returns null when there is nothing target-language to read (no analysis yet).
function userIdiomaticText(
  analysis: TutorAnalysis | null,
  rawUserText: string,
): string | null {
  if (!analysis) return null;
  if (analysis.expression_gap) {
    return analysis.expression_gap.target_expression.trim() || null;
  }
  const corrected = analysis.corrected.trim() || rawUserText.trim();
  const natural = analysis.natural.trim();
  const speakTarget = natural && natural !== corrected ? natural : corrected;
  return speakTarget || null;
}

// Flatten one conversation's turns into ordered listening lines (chronological: the learner's
// idiomatic line, then the AI reply). Say drills (dictation/shadowing) contribute only the AI's
// target sentence — the learner's transcription attempt is the same sentence and is skipped.
export function buildConversationItems(
  conv: ConversationMeta,
  turns: ChatTurn[],
): ListeningItem[] {
  const drill = parseAgentModifiers(conv.agentModifiersJson).drill;
  const sayDrill = !!drill && drill.def.interaction !== "chat";
  const items: ListeningItem[] = [];
  for (const turn of turns) {
    if (sayDrill) {
      const sentence = parseDictationReply(
        turn.partnerText ?? "",
      ).sentence.trim();
      if (sentence) items.push(makeItem(conv.id, turn.id, "ai", sentence));
      continue;
    }
    const userText = userIdiomaticText(turn.analysis, turn.userText);
    if (userText)
      items.push(
        makeItem(
          conv.id,
          turn.id,
          "user",
          userText,
          userNativePrompt(turn.analysis),
        ),
      );
    const reply = (turn.partnerText ?? "").trim();
    if (reply) items.push(makeItem(conv.id, turn.id, "ai", reply));
  }
  return items;
}
