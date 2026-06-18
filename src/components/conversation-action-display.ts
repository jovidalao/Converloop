import type { MessageKey, TFunction } from "@/i18n";
import { type ActionAgent, getBuiltinAgentOverride } from "../runtime";

const BUILTIN_ACTION_I18N: Record<
  string,
  { title: MessageKey; desc: MessageKey }
> = {
  "builtin:action:branch_from": {
    title: "agentLibrary.builtinCards.branchFrom.title",
    desc: "agentLibrary.builtinCards.branchFrom.desc",
  },
  "builtin:action:restart": {
    title: "agentLibrary.builtinCards.restart.title",
    desc: "agentLibrary.builtinCards.restart.desc",
  },
  "builtin:action:harder": {
    title: "agentLibrary.builtinCards.harder.title",
    desc: "agentLibrary.builtinCards.harder.desc",
  },
  "builtin:action:easier": {
    title: "agentLibrary.builtinCards.easier.title",
    desc: "agentLibrary.builtinCards.easier.desc",
  },
  "builtin:action:swap_roles": {
    title: "agentLibrary.builtinCards.swapRoles.title",
    desc: "agentLibrary.builtinCards.swapRoles.desc",
  },
  "builtin:action:next_day": {
    title: "agentLibrary.builtinCards.nextDay.title",
    desc: "agentLibrary.builtinCards.nextDay.desc",
  },
  "builtin:action:change_scene": {
    title: "agentLibrary.builtinCards.changeScene.title",
    desc: "agentLibrary.builtinCards.changeScene.desc",
  },
  "builtin:action:lesson_from_conversation": {
    title: "agentLibrary.builtinCards.lessonFromConversation.title",
    desc: "agentLibrary.builtinCards.lessonFromConversation.desc",
  },
};

export function conversationActionLabel(
  actionId: string,
  fallback: string,
  t: TFunction,
): string {
  if (actionId.startsWith("custom:")) return fallback;
  if (getBuiltinAgentOverride(actionId)?.label) return fallback;
  const keys = BUILTIN_ACTION_I18N[actionId];
  return keys ? t(keys.title) : fallback;
}

export function conversationActionDescription(
  actionId: string,
  fallback: string | undefined,
  t: TFunction,
): string | undefined {
  if (actionId.startsWith("custom:")) return fallback;
  if (getBuiltinAgentOverride(actionId)?.description) return fallback;
  const keys = BUILTIN_ACTION_I18N[actionId];
  return keys ? t(keys.desc) : fallback;
}

export function conversationActionDisplay(action: ActionAgent, t: TFunction) {
  return {
    label: conversationActionLabel(action.id, action.label, t),
    description: conversationActionDescription(
      action.id,
      action.description,
      t,
    ),
  };
}
