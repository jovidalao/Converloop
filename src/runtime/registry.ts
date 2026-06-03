// Agent Runtime 注册表与派发(Phase 1)。
// 内置 Agent 在 ./builtins 里通过下面的 register* 自注册(从 ./index 触发)。
// 关键:reply_producer 按 kind 唯一(查表即得),observer 可多个(派发时遍历)——
// 「新增一个 observer 不需要改 runTurn」靠的就是 getObservers() 这一层。

import { recordAgentRun } from "../db/agent-jobs";
import {
  createPendingDerivedConversation,
  getConversation,
  type NewConversationContext,
  parseAgentModifiers,
} from "../db/conversations";
import { logError } from "../lib/log";
import { getBuiltinActionOverride } from "./builtin-overrides";
import { isAgentEnabled } from "./enablement";
import {
  type ActionAgent,
  type ActionContext,
  type ActionResult,
  type ActionScope,
  type AgentCatalogEntry,
  type ConversationContext,
  type ConversationKind,
  type DerivationContext,
  HOOKS,
  type HookName,
  type Observer,
  type PracticeContext,
  type ReplyProducer,
  type TransformerInfo,
} from "./types";

const replyProducers = new Map<ConversationKind, ReplyProducer>();
const observers: Observer[] = [];
const actions: ActionAgent[] = [];
const transformers: TransformerInfo[] = [];

export function registerReplyProducer(producer: ReplyProducer): void {
  replyProducers.set(producer.conversationKind, producer);
}

export function registerObserver(observer: Observer): void {
  observers.push(observer);
}

export function registerAction(action: ActionAgent): void {
  actions.push(action);
}

export function registerTransformer(transformer: TransformerInfo): void {
  transformers.push(transformer);
}

// 把内置动作的用户改写(名称/说明)合并进去,让动作条与能力库展示一致。
// deriveContext / run 各自在执行时读改写应用 prompt,这里只覆盖展示字段。
function withActionOverride(a: ActionAgent): ActionAgent {
  const ov = getBuiltinActionOverride(a.id);
  if (!ov || (ov.label === undefined && ov.description === undefined)) return a;
  return {
    ...a,
    label: ov.label ?? a.label,
    description: ov.description ?? a.description,
    card: a.card
      ? {
          ...a.card,
          title: ov.label ?? a.card.title,
          description: ov.description ?? a.card.description,
        }
      : a.card,
  };
}

export function replaceCustomRuntimeAgents(input: {
  observers: Observer[];
  actions: ActionAgent[];
}): void {
  for (let i = observers.length - 1; i >= 0; i--) {
    if (observers[i]?.id.startsWith("custom:")) observers.splice(i, 1);
  }
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i]?.id.startsWith("custom:")) actions.splice(i, 1);
  }
  observers.push(...input.observers);
  actions.push(...input.actions);
}

export function getReplyProducer(
  kind: ConversationKind,
): ReplyProducer | undefined {
  return replyProducers.get(kind);
}

export function getObservers(): readonly Observer[] {
  return observers;
}

export function getActions(scope?: ActionScope): readonly ActionAgent[] {
  const list = scope ? actions.filter((a) => a.scope === scope) : actions;
  return list.map(withActionOverride);
}

export function getTransformers(): readonly TransformerInfo[] {
  return transformers;
}

// 能力库目录:所有注册的 Agent(含当前启用态),供 UI 展示与开关。
export function listAgentCatalog(): AgentCatalogEntry[] {
  const entries: AgentCatalogEntry[] = [];
  for (const p of replyProducers.values())
    entries.push({
      id: p.id,
      kind: p.kind,
      enabled: isAgentEnabled(p.id),
      card: p.card,
    });
  for (const o of observers)
    entries.push({
      id: o.id,
      kind: o.kind,
      enabled: isAgentEnabled(o.id),
      card: o.card,
    });
  for (const raw of actions) {
    const a = withActionOverride(raw);
    entries.push({
      id: a.id,
      kind: a.kind,
      enabled: isAgentEnabled(a.id),
      scope: a.scope,
      card: a.card,
    });
  }
  for (const t of transformers)
    entries.push({
      id: t.id,
      kind: "transformer",
      enabled: true,
      card: t.card,
    });
  return entries;
}

// 把一次 Agent 运行包成「跑完后异步落一条日志」。日志在完成后 fire-and-forget 写入,
// 绝不在 LLM 调用前插行——否则会给首 token 加一次 DB 往返(验收 #1)。
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
    }).catch((e) => logError("agent-run", "运行日志写入失败", e));
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
    }).catch((err) => logError("agent-run", "运行日志写入失败", err));
    throw e;
  }
}

// 派发主回复:按 kind 取唯一 reply_producer,流式跑,带日志。错误向上抛给 runTurn。
export async function dispatchReply(
  ctx: ConversationContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const producer = getReplyProducer(ctx.kind);
  if (!producer) throw new Error(`没有注册 ${ctx.kind} 的回复 Agent`);
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

// 派发 observer:遍历所有注册的 observer 并行触发,fire-and-forget(不阻塞下一轮输入)。
// 每个 observer 自行 await ctx.turnPersisted 后再写回,并自管 UI 回调与错误展示。
export function dispatchObservers(ctx: PracticeContext): void {
  const active = getObservers().filter((o) => isAgentEnabled(o.id));
  // 没有启用的 observer(如用户关掉了导师)→ 通知 UI 本轮无批改,清掉「分析中」pending。
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
    ).catch((e) => logError("agent-observe", `${observer.id} 运行失败`, e));
  }
}

// 运行一个会话动作 Agent(用户点击触发)。带日志,结果回传给 UI(通常含要跳转的新会话 id)。
export async function runAction(
  actionId: string,
  ctx: ActionContext,
): Promise<ActionResult> {
  const action = actions.find((a) => a.id === actionId);
  if (!action) throw new Error(`没有注册 id=${actionId} 的动作 Agent`);
  const run = action.run;
  if (!run) throw new Error(`动作 ${actionId} 不是直接执行动作`);
  return runLogged(
    {
      agentId: action.id,
      hook: HOOKS.conversationAction,
      turnId: ctx.sourceTurnId,
    },
    () => run(ctx),
  );
}

// 用户点击动作时先建 pending 衍生会话,让 UI 可以立刻跳过去显示加载态。
// 非衍生动作(如「变成专项课」)仍退回 runAction。
export async function beginAction(
  actionId: string,
  ctx: ActionContext,
): Promise<ActionResult> {
  const found = actions.find((a) => a.id === actionId);
  if (!found) throw new Error(`没有注册 id=${actionId} 的动作 Agent`);
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

// 新衍生会话页面挂载后调用:读取 pending 状态,运行对应 action agent 生成新上下文。
// 这里只负责 Agent 运行与日志;持久化 ready/failed 状态由 orchestrator 处理,避免 registry
// 直接决定会话开场逻辑。
export async function derivePendingAction(
  newConversationId: string,
): Promise<NewConversationContext> {
  const conversation = await getConversation(newConversationId);
  const modifiers = parseAgentModifiers(
    conversation?.agentModifiersJson ?? null,
  );
  const derivation = modifiers.derivation;
  if (!conversation || !derivation) {
    throw new Error("这个会话没有待生成的对话衍生上下文");
  }
  if (!conversation.parentConversationId) {
    throw new Error("衍生会话缺少来源对话");
  }
  const action = actions.find((a) => a.id === derivation.actionId);
  if (!action?.deriveContext) {
    throw new Error(`动作 ${derivation.actionId} 不能生成对话衍生上下文`);
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

// 按需 transformer(讲解 / 双语 / 划词)不走热路径派发,但仍进入能力库与运行日志。
export async function runTransformer<T>(
  transformerId: string,
  hook: HookName,
  fn: () => Promise<T>,
  summarize?: (result: T) => unknown,
): Promise<T> {
  const transformer = transformers.find((t) => t.id === transformerId);
  if (!transformer)
    throw new Error(`没有注册 id=${transformerId} 的转换 Agent`);
  return runLogged(
    {
      agentId: transformer.id,
      hook,
      summarize,
    },
    fn,
  );
}
