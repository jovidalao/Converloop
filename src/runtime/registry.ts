// Agent Runtime registry and dispatch (Phase 1).
// Built-in agents in ./builtins self-register via the register* functions below (triggered from ./index).
// Key invariant: reply_producer is unique per kind (direct map lookup); observers can be multiple (iterated on dispatch) —
// "adding a new observer without touching runTurn" is exactly what the getObservers() indirection provides.

import { recordAgentRun } from "../db/agent-jobs";
import {
  createPendingDerivedConversation,
  getConversation,
  type NewConversationContext,
  parseAgentModifiers,
} from "../db/conversations";
import { logError } from "../lib/log";
import { getBuiltinAgentOverride } from "./builtin-overrides";
import { isAgentEnabled } from "./enablement";
import {
  type ActionAgent,
  type ActionContext,
  type ActionResult,
  type ActionScope,
  type AgentCard,
  type AgentCatalogEntry,
  type ConversationContext,
  type ConversationKind,
  type DerivationContext,
  HOOKS,
  type HookName,
  type Observer,
  type PracticeContext,
  type ReplyProducer,
  type ReplyTransformer,
  type ReplyTransformerInput,
  type ReplyTransformerResult,
  type TransformerInfo,
  type TransformerStage,
} from "./types";
import { isAgentHidden } from "./visibility";

const replyProducers = new Map<ConversationKind, ReplyProducer>();
const observers: Observer[] = [];
const actions: ActionAgent[] = [];
const transformers: TransformerInfo[] = [];
const replyTransformers: ReplyTransformer[] = [];

// Idempotent registration: re-registering an id replaces the existing entry instead of appending.
// builtins.ts registers via module-level side effects; under Vite/React-Fast-Refresh that module
// re-executes on hot reload while these arrays (in this separate module) persist, so without dedup
// the built-ins accumulate duplicates — visible as repeated "Branch from here" buttons on every user
// message, and as observers firing multiple times per turn.
function upsertById<T extends { id: string }>(list: T[], item: T): void {
  const i = list.findIndex((entry) => entry.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

export function registerReplyProducer(producer: ReplyProducer): void {
  replyProducers.set(producer.conversationKind, producer);
}

export function registerObserver(observer: Observer): void {
  upsertById(observers, observer);
}

export function registerAction(action: ActionAgent): void {
  upsertById(actions, action);
}

export function registerTransformer(transformer: TransformerInfo): void {
  upsertById(transformers, transformer);
}

// Merge user overrides (name/description) for built-in agents into their display card, so the action bar and agent library stay consistent.
// Supplemental instructions are read and appended by each capability at execution time; only display fields are overridden here.
function applyCardOverride(
  id: string,
  card?: AgentCard,
): AgentCard | undefined {
  if (!card) return card;
  const ov = getBuiltinAgentOverride(id);
  if (!ov || (ov.label === undefined && ov.description === undefined))
    return card;
  return {
    ...card,
    title: ov.label ?? card.title,
    description: ov.description ?? card.description,
  };
}

// Actions are rendered in the menu using label/description, so overrides must be merged into the action itself (not just the card).
function withActionOverride(a: ActionAgent): ActionAgent {
  const ov = getBuiltinAgentOverride(a.id);
  if (!ov || (ov.label === undefined && ov.description === undefined)) return a;
  return {
    ...a,
    label: ov.label ?? a.label,
    description: ov.description ?? a.description,
    card: applyCardOverride(a.id, a.card),
  };
}

export function replaceCustomRuntimeAgents(input: {
  observers: Observer[];
  actions: ActionAgent[];
  replyTransformers: ReplyTransformer[];
}): void {
  for (let i = observers.length - 1; i >= 0; i--) {
    if (observers[i]?.id.startsWith("custom:")) observers.splice(i, 1);
  }
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i]?.id.startsWith("custom:")) actions.splice(i, 1);
  }
  for (let i = replyTransformers.length - 1; i >= 0; i--) {
    if (replyTransformers[i]?.id.startsWith("custom:"))
      replyTransformers.splice(i, 1);
  }
  observers.push(...input.observers);
  actions.push(...input.actions);
  replyTransformers.push(...input.replyTransformers);
}

export function getReplyProducer(
  kind: ConversationKind,
): ReplyProducer | undefined {
  return replyProducers.get(kind);
}

export function getObservers(): readonly Observer[] {
  return observers;
}

// Hidden actions (user "deleted" them in the agent library) do not appear in any menu. There is no restore path, so filter them out at the dispatch source.
export function getActions(scope?: ActionScope): readonly ActionAgent[] {
  const list = (scope ? actions.filter((a) => a.scope === scope) : actions)
    .filter((a) => !isAgentHidden(a.id))
    .map(withActionOverride);
  return list;
}

export function getTransformers(): readonly TransformerInfo[] {
  return transformers;
}

// Reply transformers shown as per-turn buttons: hidden (deleted) and disabled ones drop out, like the builtin *Hidden flags.
// Pass a stage to get only the transformers that attach to that turn (ai_reply = under the AI reply,
// user_message = under the learner's message); omit it to get all (used by tests).
export function getReplyTransformers(
  stage?: TransformerStage,
): readonly ReplyTransformer[] {
  return replyTransformers.filter(
    (t) =>
      !isAgentHidden(t.id) &&
      isAgentEnabled(t.id) &&
      (stage === undefined || t.stage === stage),
  );
}

// Agent library catalog: all registered agents (with current enabled state), for UI display and toggling.
export function listAgentCatalog(): AgentCatalogEntry[] {
  const entries: AgentCatalogEntry[] = [];
  for (const p of replyProducers.values())
    entries.push({
      id: p.id,
      kind: p.kind,
      enabled: isAgentEnabled(p.id),
      card: applyCardOverride(p.id, p.card),
    });
  for (const o of observers)
    entries.push({
      id: o.id,
      kind: o.kind,
      enabled: isAgentEnabled(o.id),
      card: applyCardOverride(o.id, o.card),
    });
  for (const a of actions)
    entries.push({
      id: a.id,
      kind: a.kind,
      enabled: isAgentEnabled(a.id),
      scope: a.scope,
      card: applyCardOverride(a.id, a.card),
    });
  for (const t of transformers)
    entries.push({
      id: t.id,
      kind: "transformer",
      enabled: true,
      card: applyCardOverride(t.id, t.card),
    });
  for (const t of replyTransformers)
    entries.push({
      id: t.id,
      kind: "transformer",
      enabled: isAgentEnabled(t.id),
      card: applyCardOverride(t.id, t.card),
      icon: t.icon,
    });
  // Hidden (permanently deleted) capabilities do not appear in the library and cannot be restored.
  return entries.filter((e) => !isAgentHidden(e.id));
}

// Wrap an agent run so that a log entry is written asynchronously after the run completes. The log is fire-and-forget after completion,
// and is never inserted before the LLM call — doing so would add a DB round-trip to first-token latency (acceptance criterion #1).
async function runLogged<T>(
  meta: {
    agentId: string;
    hook: HookName;
    turnId?: string;
    summarize?: (result: T) => unknown;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    void recordAgentRun({
      kind: meta.hook,
      source: "conversation",
      agentId: meta.agentId,
      turnId: meta.turnId,
      status: "succeeded",
      output: meta.summarize?.(result),
      startedAt,
      finishedAt: Date.now(),
    }).catch((e) => logError("agent-run", "Failed to write agent run log", e));
    return result;
  } catch (e) {
    void recordAgentRun({
      kind: meta.hook,
      source: "conversation",
      agentId: meta.agentId,
      turnId: meta.turnId,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      startedAt,
      finishedAt: Date.now(),
    }).catch((err) =>
      logError("agent-run", "Failed to write agent run log", err),
    );
    throw e;
  }
}

// Dispatch the main reply: look up the unique reply_producer by kind, run it streaming with logging. Errors propagate up to runTurn.
export async function dispatchReply(
  ctx: ConversationContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const producer = getReplyProducer(ctx.kind);
  if (!producer) throw new Error(`No reply agent registered for ${ctx.kind}`);
  return runLogged(
    {
      agentId: producer.id,
      hook: HOOKS.conversationReply,
      turnId: ctx.turnId,
      summarize: (reply: string) => ({ chars: reply.length }),
    },
    () => producer.run(ctx, onDelta),
  );
}

// Dispatch observers: iterate all registered observers and fire them in parallel, fire-and-forget (non-blocking for the next user input).
// Each observer awaits ctx.turnPersisted before writing back, and manages its own UI callbacks and error display.
export function dispatchObservers(ctx: PracticeContext): void {
  const active = getObservers().filter((o) => isAgentEnabled(o.id));
  // No enabled observers (e.g. user turned off the tutor) → notify UI there is no correction this turn, clear the "analyzing" pending state.
  if (active.length === 0) {
    ctx.callbacks.onAnalysis(null);
    return;
  }
  for (const observer of active) {
    void runLogged(
      {
        agentId: observer.id,
        hook: HOOKS.conversationObserve,
        turnId: ctx.turnId,
      },
      () => observer.run(ctx),
    ).catch((e) => logError("agent-observe", `${observer.id} failed`, e));
  }
}

// Run a conversation action agent (triggered by user click). Logged; result is returned to the UI (typically contains the new conversation id to navigate to).
export async function runAction(
  actionId: string,
  ctx: ActionContext,
): Promise<ActionResult> {
  const action = actions.find((a) => a.id === actionId);
  if (!action)
    throw new Error(`No action agent registered with id=${actionId}`);
  const run = action.run;
  if (!run)
    throw new Error(`Action ${actionId} is not a directly executable action`);
  return runLogged(
    {
      agentId: action.id,
      hook: HOOKS.conversationAction,
      turnId: ctx.sourceTurnId,
    },
    () => run(ctx),
  );
}

// When the user clicks an action, first create a pending derived conversation so the UI can navigate there immediately and show a loading state.
// Non-derivation actions (e.g. "turn into a focused lesson") fall back to runAction.
export async function beginAction(
  actionId: string,
  ctx: ActionContext,
): Promise<ActionResult> {
  const found = actions.find((a) => a.id === actionId);
  if (!found) throw new Error(`No action agent registered with id=${actionId}`);
  if (!found.deriveContext) return runAction(actionId, ctx);
  const action = withActionOverride(found);

  const id = await createPendingDerivedConversation({
    parentId: ctx.conversationId,
    actionId: action.id,
    actionLabel: action.label,
    branchKind: action.branchKind ?? "custom_action",
    sourceTurnId: ctx.sourceTurnId ?? null,
    baseModifiers: action.baseModifiers,
  });
  return { navigateTo: id };
}

// Called when a new derived conversation page mounts: reads the pending state, runs the corresponding action agent to generate the new context.
// This function is only responsible for agent execution and logging; persisting the ready/failed state is handled by the orchestrator,
// so the registry does not directly control conversation startup logic.
export async function derivePendingAction(
  newConversationId: string,
): Promise<NewConversationContext> {
  const conversation = await getConversation(newConversationId);
  const modifiers = parseAgentModifiers(
    conversation?.agentModifiersJson ?? null,
  );
  const derivation = modifiers.derivation;
  if (!conversation || !derivation) {
    throw new Error(
      "This conversation has no pending derivation context to generate",
    );
  }
  if (!conversation.parentConversationId) {
    throw new Error("Derived conversation is missing a source conversation");
  }
  const action = actions.find((a) => a.id === derivation.actionId);
  if (!action?.deriveContext) {
    throw new Error(
      `Action ${derivation.actionId} cannot generate a derived conversation context`,
    );
  }
  const ctx: DerivationContext = {
    newConversationId,
    sourceConversationId: conversation.parentConversationId,
    sourceTurnId: conversation.branchSourceTurnId,
  };
  return runLogged(
    {
      agentId: action.id,
      hook: HOOKS.conversationAction,
      turnId: ctx.sourceTurnId ?? undefined,
      summarize: (result: NewConversationContext) => ({
        title: result.title,
        scenario: result.scenario,
      }),
    },
    () => action.deriveContext?.(ctx) as Promise<NewConversationContext>,
  );
}

// On-demand transformers (explain / bilingual / selection translate) do not go through hot-path dispatch, but still appear in the agent library and run log.
export async function runTransformer<T>(
  transformerId: string,
  hook: HookName,
  fn: () => Promise<T>,
  summarize?: (result: T) => unknown,
): Promise<T> {
  const transformer = transformers.find((t) => t.id === transformerId);
  if (!transformer)
    throw new Error(`No transformer agent registered with id=${transformerId}`);
  // Safety fallback: even if the trigger button is hidden, refuse to run a deleted capability.
  if (isAgentHidden(transformerId))
    throw new Error(`Capability ${transformerId} has been deleted`);
  return runLogged(
    {
      agentId: transformer.id,
      hook,
      summarize,
    },
    fn,
  );
}

// Run a custom reply transformer (user-click or auto-run on a reply). Logged under turn.reply_transform; the agent's run() self-assembles provider/config.
export async function runReplyTransformer(
  id: string,
  input: ReplyTransformerInput,
): Promise<ReplyTransformerResult> {
  const transformer = replyTransformers.find((t) => t.id === id);
  if (!transformer)
    throw new Error(`No reply transformer registered with id=${id}`);
  if (isAgentHidden(id)) throw new Error(`Capability ${id} has been deleted`);
  return runLogged(
    {
      agentId: transformer.id,
      hook: HOOKS.turnReplyTransform,
      turnId: input.turnId,
      summarize: (r: ReplyTransformerResult) => ({
        mode: transformer.outputMode,
        chars: r.markdown?.length ?? 0,
      }),
    },
    () => transformer.run(input),
  );
}
