import type { ChatMessage } from "../providers/types";

/** One past conversation turn, already mapped to display text. The user side is
 *  empty for an app-triggered opener (derived conversation / lesson kickoff) that
 *  has no learner input. */
export interface HistoryTurn {
  user: string;
  reply: string;
}

// Neutral cue placed before a partner-only opener so the message list starts with
// a user turn: Anthropic/Gemini require the first non-system message to come from
// the user, but an app-opened (derived/lesson) conversation begins with the
// partner speaking.
const OPENER_CUE = "(Conversation begins.)";

// Turn the verbatim history into real alternating user/assistant messages instead
// of one flattened "User: … / Partner: …" transcript, so the model never loses
// track of whose turn it is and stops occasionally replying in the user's voice.
export function buildHistoryMessages(turns: HistoryTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    if (turn.user) messages.push({ role: "user", content: turn.user });
    if (turn.reply) messages.push({ role: "assistant", content: turn.reply });
  }
  if (messages[0]?.role === "assistant") {
    messages.unshift({ role: "user", content: OPENER_CUE });
  }
  return messages;
}
