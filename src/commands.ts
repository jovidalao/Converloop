// Chat-bar slash commands (/btw, /help, and thin entry points into existing conversation actions).
// This file only handles pure logic for "command definition + parsing/matching"; the UI is in SlashMenu and the dispatch happens in ChatView.
// Intentionally not wired into the Agent Runtime hook system: slash commands are an input-layer concern, kept as a lightweight independent layer.
// The only dependency is the enablement leaf module (pure localStorage, no db/provider side effects), keeping it testable.

import { isAgentEnabled } from "./runtime/enablement";

export type SlashCommandKind = "message" | "action" | "meta" | "prompt";

export interface SlashCommand {
  /** Command name without the slash, lowercase, e.g. "btw". */
  name: string;
  description: string;
  /** Argument hint (for "message"/"prompt" kinds), e.g. "<something to ask the AI>". */
  argsHint?: string;
  kind: SlashCommandKind;
  /** For "action" kind: the id of the existing conversation.action Agent to reuse. */
  actionId?: string;
  /**
   * For "prompt" kind: build the expanded prompt sent to the conversation agent from the typed args.
   * Unlike "action" commands (which branch into a new conversation), prompt macros stay in the current
   * conversation as a turn — the bubble shows the verbatim command, the agent receives this expanded prompt.
   */
  buildPrompt?: (rest: string) => string;
  /** For "prompt" kind: when true, an empty body does not send (e.g. /topic needs pasted material). */
  requiresArgs?: boolean;
}

// Command list. message/meta are new behaviors; action kinds are thin entry points into existing conversation actions (builtin:action:*),
// introducing no new backend logic — execution still goes through ChatView's runConversationAction → beginAction.
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "btw",
    description: "Side question: excluded from context and grading",
    argsHint: "<ask the AI anything>",
    kind: "message",
  },
  {
    name: "help",
    description: "Show all available commands",
    kind: "meta",
  },
  {
    name: "topic",
    description: "Center the conversation on pasted material",
    argsHint: "<paste your material>",
    kind: "prompt",
    requiresArgs: true,
    buildPrompt: (rest) =>
      `The user pasted the material below and wants this conversation to center on it. Read it, then naturally open a conversation about it — lead with your own angle or a question that gets the user talking about it. Don't summarize it back or quiz them mechanically. Material:\n\n${rest}`,
  },
  {
    name: "learn",
    description: "Learn a topic through conversation",
    argsHint: "<what to learn>",
    kind: "prompt",
    buildPrompt: (rest) => {
      const subject = rest.trim() ? `"${rest.trim()}"` : "the current topic";
      return `The user wants to learn about ${subject} through conversation. Act as a tutor-by-dialogue: give a short, level-appropriate way in, then teach interactively — explain a little, show an example, and ask a question that gets the user to use it, one step at a time. Keep it a back-and-forth, not a lecture.`;
    },
  },
  {
    name: "surprise",
    description: "Start chatting about a random topic",
    kind: "prompt",
    buildPrompt: () =>
      "Pick an interesting, everyday topic at random and start a fresh, casual conversation about it — open with a hook or a question that gets the user talking. Keep it at the user's level.",
  },
  {
    name: "harder",
    description:
      "Increase difficulty: branch into a harder version of the current conversation",
    kind: "action",
    actionId: "builtin:action:harder",
  },
  {
    name: "easier",
    description: "Decrease difficulty: branch into an easier version",
    kind: "action",
    actionId: "builtin:action:easier",
  },
  {
    name: "swap",
    description: "Swap roles: branch into a role-reversed version",
    kind: "action",
    actionId: "builtin:action:swap_roles",
  },
  {
    name: "restart",
    description: "Restart: keep the setup, open a blank branch for re-practice",
    kind: "action",
    actionId: "builtin:action:restart",
  },
  {
    name: "next-day",
    description:
      "Continue next day: branch into a new-day continuation of the current story",
    kind: "action",
    actionId: "builtin:action:next_day",
  },
];

export interface ParsedSlash {
  command: SlashCommand;
  /** Arguments after the command word (leading/trailing whitespace stripped); empty string if no arguments. */
  rest: string;
}

// Command routing on submit: must start with /, first word must be a known command name. Unknown commands return null (sent as plain text).
export function parseSlashInput(raw: string): ParsedSlash | null {
  const m = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(raw);
  if (!m) return null;
  const command = SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase());
  if (!command) return null;
  return { command, rest: (m[2] ?? "").trim() };
}

// Menu state detection: returns the command token being typed (possibly empty) when input starts with / and the command word is still being edited (no space yet).
// Returns null (menu closed) once a space appears after the command word (entering the "enter arguments" state) or the input does not start with /.
export function slashMenuToken(input: string): string | null {
  const m = /^\/([a-zA-Z][\w-]*)?$/.exec(input);
  return m ? (m[1] ?? "") : null;
}

export interface SlashMenuContext {
  /** Whether branching is available (practice conversation and not a draft); when false, action-kind commands are hidden. */
  canDerive: boolean;
  /** Focused-lesson session: prompt macros (/topic, /learn, /surprise) would fight the lesson script, so they are hidden. */
  isLearning: boolean;
}

// Filter + sort for the menu: match by command word prefix or substring, startsWith ranked first;
// action-kind commands are excluded when branching is unavailable or the corresponding agent is disabled;
// prompt-kind commands are excluded in focused lessons.
export function matchSlashCommands(
  token: string,
  ctx: SlashMenuContext,
): SlashCommand[] {
  const q = token.toLowerCase();
  const available = SLASH_COMMANDS.filter((c) => {
    if (c.kind === "action") {
      if (!ctx.canDerive) return false;
      if (c.actionId && !isAgentEnabled(c.actionId)) return false;
    }
    if (c.kind === "prompt" && ctx.isLearning) return false;
    return true;
  });
  if (!q) return available;
  return available
    .filter((c) => c.name.includes(q))
    .sort(
      (a, b) => (a.name.startsWith(q) ? 0 : 1) - (b.name.startsWith(q) ? 0 : 1),
    );
}
