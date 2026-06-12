// Chat-bar slash commands (/btw, action shortcuts, and customizable prompt macros).
// This file handles "command definition + parsing/matching"; the UI is in SlashMenu, dispatch in ChatView,
// and the prompt-macro customization UI in SettingsView. Prompt macros are template-based (see
// BUILTIN_PROMPT_MACROS) so users can edit the built-ins and add their own; their persistence lives in
// runtime/prompt-macro-store. Intentionally not wired into the Agent Runtime hook system: slash commands
// are an input-layer concern. Dependencies are leaf localStorage modules (no db/provider side effects).

import type { MessageKey } from "./i18n";
import { isAgentEnabled } from "./runtime/enablement";
import {
  type CustomPromptMacro,
  getCustomPromptMacros,
  getPromptMacroOverrides,
} from "./runtime/prompt-macro-store";

export type SlashCommandKind = "message" | "action" | "prompt";

export interface SlashCommand {
  /** Command name without the slash, lowercase, e.g. "btw". */
  name: string;
  /** English description; the canonical default (and the stored text once a user edits a macro). */
  description: string;
  /** i18n key for the localized menu description. Unset when the user overrode `description` (their text wins). */
  descriptionKey?: MessageKey;
  /** Argument hint (for "message"/"prompt" kinds), e.g. "<something to ask the AI>". */
  argsHint?: string;
  /** i18n key for the localized args hint. Unset when the user overrode `argsHint`. */
  argsHintKey?: MessageKey;
  kind: SlashCommandKind;
  /** For "action" kind: the id of the existing conversation.action Agent to reuse. */
  actionId?: string;
  /**
   * For "prompt" kind: build the expanded prompt sent to the conversation agent from the typed args.
   * Unlike "action" commands (which branch into a new conversation), prompt macros stay in the current
   * conversation as a turn — the bubble shows the verbatim command, the agent receives this expanded prompt.
   */
  buildPrompt?: (rest: string) => string;
  /** For "prompt" kind: when true, an empty body does not send (e.g. /topic needs a topic). */
  requiresArgs?: boolean;
  /** Provenance badge for the menu: a user-defined macro or an edited built-in. Unset = stock built-in. */
  source?: "custom" | "edited";
}

// The token inside a prompt-macro template that is replaced by the user's typed args. A template that
// contains it "takes a body" (shown as body mode in the menu, required to send); one that doesn't is a
// no-arg macro (like /surprise) that runs immediately.
export const PROMPT_INPUT_TOKEN = "{input}";
const GENERIC_ARGS_HINT = "<your input>";

// A prompt-macro definition (built-in default or user-defined): a template with an optional {input} slot.
export interface PromptMacroDef {
  name: string;
  description: string;
  descriptionKey?: MessageKey;
  argsHint?: string;
  argsHintKey?: MessageKey;
  template: string;
}

// Built-in prompt macros. Templates are English (the conversation partner replies in the target
// language regardless); description/argsHint defaults are English with an i18n key for menu display.
// Users can override any field in settings or hide nothing — only add/edit.
export const BUILTIN_PROMPT_MACROS: PromptMacroDef[] = [
  {
    name: "topic",
    description: "Switch the conversation to a topic",
    descriptionKey: "slashCommands.topic",
    argsHint: "<topic>",
    argsHintKey: "slashCommands.topicHint",
    template: `Switch the conversation to this topic now: "${PROMPT_INPUT_TOKEN}". Treat this as an explicit topic change, not as learner speech and not as a request to continue the previous thread. Open naturally with your own angle or a question that gets the user talking about it. Don't summarize the topic back or quiz them mechanically. Keep it to one or two sentences in the target language.`,
  },
  {
    name: "roleplay",
    description: "Role-play a scenario in this conversation",
    descriptionKey: "slashCommands.roleplay",
    argsHint: "<scenario>",
    argsHintKey: "slashCommands.roleplayHint",
    template: `Start a role-play of this scenario now: "${PROMPT_INPUT_TOKEN}". Take the natural counterpart role yourself and tell the user their role in one short line, then open the scene in character in the target language. Stay in character, keep each turn short, and let the user carry their side.`,
  },
  {
    name: "learn",
    description: "Learn a topic through conversation",
    descriptionKey: "slashCommands.learn",
    argsHint: "<what to learn>",
    argsHintKey: "slashCommands.learnHint",
    template: `The user wants to learn about "${PROMPT_INPUT_TOKEN}" through conversation. Act as a tutor-by-dialogue: give a short, level-appropriate way in, then teach interactively — explain a little, show an example, and ask a question that gets the user to use it, one step at a time. Keep it a back-and-forth, not a lecture.`,
  },
  {
    name: "surprise",
    description: "Start chatting about a random topic",
    descriptionKey: "slashCommands.surprise",
    template:
      "Pick an interesting, everyday topic at random and start a fresh, casual conversation about it — open with a hook or a question that gets the user talking. Keep it at the user's level.",
  },
  {
    name: "how",
    description: "Ask how to say something in the target language",
    descriptionKey: "slashCommands.how",
    argsHint: "<what you want to say>",
    argsHintKey: "slashCommands.howHint",
    template: `The user wants to express this: "${PROMPT_INPUT_TOKEN}". Give the most natural way to say it in the target language, plus one alternative with a different tone or formality if useful. Add a one-line note on nuance or a common mistake, then invite the user to try it in a sentence of their own.`,
  },
  {
    name: "recap",
    description: "Recap this conversation: takeaways and what to review",
    descriptionKey: "slashCommands.recap",
    template:
      "Give a short recap of the conversation so far: what was practiced, what the user did well, the mistakes most worth remembering, and two or three useful expressions to review. Keep it compact and scannable, then ask one question that lets the user retry their weakest spot.",
  },
];

// Static (non-customizable) commands. Split so prompt macros sit between them in the menu order:
// quick message commands first, then prompt macros, then conversation-branching actions.
const MESSAGE_COMMANDS: SlashCommand[] = [
  {
    name: "btw",
    description: "Standalone side question: excluded from context and grading",
    descriptionKey: "slashCommands.btw",
    argsHint: "<ask the AI anything>",
    argsHintKey: "slashCommands.btwHint",
    kind: "message",
  },
];

const ACTION_COMMANDS: SlashCommand[] = [
  {
    name: "harder",
    description:
      "Increase difficulty: branch into a harder version of the current conversation",
    descriptionKey: "slashCommands.harder",
    kind: "action",
    actionId: "builtin:action:harder",
  },
  {
    name: "easier",
    description: "Decrease difficulty: branch into an easier version",
    descriptionKey: "slashCommands.easier",
    kind: "action",
    actionId: "builtin:action:easier",
  },
  {
    name: "swap",
    description: "Swap roles: branch into a role-reversed version",
    descriptionKey: "slashCommands.swap",
    kind: "action",
    actionId: "builtin:action:swap_roles",
  },
  {
    name: "scene",
    description: "Change scene: keep the practice goal, switch the setting",
    descriptionKey: "slashCommands.scene",
    kind: "action",
    actionId: "builtin:action:change_scene",
  },
  {
    name: "restart",
    description: "Restart: keep the setup, open a blank branch for re-practice",
    descriptionKey: "slashCommands.restart",
    kind: "action",
    actionId: "builtin:action:restart",
  },
  {
    name: "next-day",
    description:
      "Continue next day: branch into a new-day continuation of the current story",
    descriptionKey: "slashCommands.nextDay",
    kind: "action",
    actionId: "builtin:action:next_day",
  },
];

const NAME_RE = /^[a-z][\w-]*$/;

// Turn a macro definition (built-in-with-overrides or custom) into a runnable SlashCommand. Returns null
// for an invalid name or empty template so a half-edited custom macro never breaks the menu / parsing.
function macroToCommand(def: {
  name: string;
  description?: string;
  argsHint?: string;
  template: string;
}): SlashCommand | null {
  const name = def.name.trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  const template = def.template;
  if (!template.trim()) return null;
  const takesBody = template.includes(PROMPT_INPUT_TOKEN);
  return {
    name,
    description: def.description?.trim() || "",
    argsHint: takesBody ? def.argsHint?.trim() || GENERIC_ARGS_HINT : undefined,
    kind: "prompt",
    requiresArgs: takesBody,
    // split/join (not replace) so a "$" in the typed args isn't treated as a replacement pattern.
    buildPrompt: (rest) => template.split(PROMPT_INPUT_TOKEN).join(rest),
  };
}

function isReservedName(name: string): boolean {
  return (
    MESSAGE_COMMANDS.some((c) => c.name === name) ||
    ACTION_COMMANDS.some((c) => c.name === name) ||
    BUILTIN_PROMPT_MACROS.some((m) => m.name === name)
  );
}

// Built-in macros with user overrides applied, then valid custom macros (skipping names that collide
// with a built-in/static command or an earlier custom one). Localized menu keys only apply to fields
// the user hasn't overridden (their text wins); overridden/custom macros carry a provenance badge.
export function resolvePromptMacros(): SlashCommand[] {
  const overrides = getPromptMacroOverrides();
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const def of BUILTIN_PROMPT_MACROS) {
    const ov = overrides[def.name] ?? {};
    const cmd = macroToCommand({
      name: def.name,
      description: ov.description || def.description,
      argsHint: ov.argsHint || def.argsHint,
      template: ov.template || def.template,
    });
    if (cmd) {
      if (Object.keys(ov).length > 0) cmd.source = "edited";
      if (!ov.description) cmd.descriptionKey = def.descriptionKey;
      if (!ov.argsHint && cmd.argsHint) cmd.argsHintKey = def.argsHintKey;
      out.push(cmd);
      seen.add(cmd.name);
    }
  }
  for (const custom of getCustomPromptMacros()) {
    const cmd = macroToCommand(custom);
    if (cmd && !isReservedName(cmd.name) && !seen.has(cmd.name)) {
      cmd.source = "custom";
      out.push(cmd);
      seen.add(cmd.name);
    }
  }
  return out;
}

// The full live command list: static message commands + resolved prompt macros + branching actions.
// Recomputed on demand so settings edits to prompt macros take effect without a reload.
export function getSlashCommands(): SlashCommand[] {
  return [...MESSAGE_COMMANDS, ...resolvePromptMacros(), ...ACTION_COMMANDS];
}

// Reserved + existing names a new custom macro must not reuse. Excludes `exceptId`'s own name so the
// settings editor can validate a row against the others without flagging its current name.
export function takenMacroNames(
  custom: CustomPromptMacro[],
  exceptId?: string,
): Set<string> {
  const names = new Set<string>([
    ...MESSAGE_COMMANDS.map((c) => c.name),
    ...ACTION_COMMANDS.map((c) => c.name),
    ...BUILTIN_PROMPT_MACROS.map((m) => m.name),
  ]);
  for (const c of custom) {
    if (c.id !== exceptId && c.name.trim())
      names.add(c.name.trim().toLowerCase());
  }
  return names;
}

export function isValidMacroName(name: string): boolean {
  return NAME_RE.test(name.trim().toLowerCase());
}

export interface ParsedSlash {
  command: SlashCommand;
  /** Arguments after the command word (leading/trailing whitespace stripped); empty string if no arguments. */
  rest: string;
}

// Command routing on submit: must start with /, first word must be a known command name. Unknown commands return null (sent as plain text).
export function parseSlashInput(raw: string): ParsedSlash | null {
  const m = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(raw);
  if (!m) return null;
  const command = getSlashCommands().find((c) => c.name === m[1].toLowerCase());
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
  const available = getSlashCommands().filter((c) => {
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
