import { and, asc, count, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "./client";
import { type Conversation, conversation, type Turn, turn } from "./schema";

export type ConversationMeta = Conversation;
export type ConversationKind = Conversation["kind"];

// 会话分支(Phase 3)。分支是非破坏式动作:从原会话派生新会话,原会话保持不变。
export type BranchKind =
  | "branch_from"
  | "restart"
  | "harder"
  | "easier"
  | "swap_roles"
  | "next_day"
  | "change_scene"
  | "custom_action";

export const BRANCH_KIND_LABEL: Record<BranchKind, string> = {
  branch_from: "分支",
  restart: "重新开始",
  harder: "更高难度",
  easier: "更简单",
  swap_roles: "调换角色",
  next_day: "第二天",
  change_scene: "换个场景",
  custom_action: "自定义动作",
};

export interface NewConversationContext {
  title: string;
  scenario: string;
  userRole: string;
  aiRole: string;
  difficulty: string;
  continuitySummary: string;
  openingInstruction: string;
  constraints: string[];
}

export interface ConversationDerivationState {
  actionId: string;
  actionLabel: string;
  status: "pending" | "ready" | "failed";
  sourceTurnId?: string | null;
  createdAt: number;
  completedAt?: number;
  error?: string | null;
}

// 会话级调节:回复 Agent 要遵循的行为变化。LLM 观察,行为由代码注入(格式化成指令)。
export interface AgentModifiers {
  difficultyDelta?: number; // +1 更难 / -1 更简单
  swapRoles?: boolean;
  nextDay?: boolean;
  note?: string; // 自由补充指令
  derivation?: ConversationDerivationState;
  derivedContext?: NewConversationContext;
}

export function parseAgentModifiers(json: string | null): AgentModifiers {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as AgentModifiers;
    }
  } catch {
    // 损坏的 JSON 退化为无调节
  }
  return {};
}

// 把会话级调节转成喂给对话 Agent 的英文指令;无调节返回空串。
export function formatModifierInstructions(mods: AgentModifiers): string {
  const lines: string[] = [];
  if (mods.difficultyDelta && mods.difficultyDelta > 0)
    lines.push(
      "- Push the difficulty noticeably HIGHER than this learner's usual level: longer, richer, more idiomatic sentences that stretch them, while staying just within reach.",
    );
  if (mods.difficultyDelta && mods.difficultyDelta < 0)
    lines.push(
      "- EASE the difficulty below this learner's usual level: shorter sentences, high-frequency vocabulary, one idea at a time.",
    );
  if (mods.swapRoles)
    lines.push(
      "- Swap conversational roles: let the LEARNER lead and ask the questions; you mostly respond and follow their lead, nudging them to drive the exchange.",
    );
  if (mods.nextDay)
    lines.push(
      "- This conversation resumes an earlier one on a NEW DAY. Open with a brief, natural reconnection (a greeting or callback to before), then carry on — do not restart from scratch.",
    );
  if (mods.derivedContext) {
    const ctx = mods.derivedContext;
    lines.push(`- This is a derived conversation. Use the generated context below as the source of truth for this new conversation. Do not mention that it was generated, and do not recap it as a list.
  Title: ${ctx.title}
  Scenario: ${ctx.scenario}
  Learner role: ${ctx.userRole}
  AI role: ${ctx.aiRole}
  Difficulty: ${ctx.difficulty}
  Continuity summary: ${ctx.continuitySummary || "(none)"}
  Opening instruction: ${ctx.openingInstruction}
  Constraints: ${
    ctx.constraints.length > 0 ? ctx.constraints.join(" / ") : "(none)"
  }`);
  }
  if (mods.note?.trim()) lines.push(`- ${mods.note.trim()}`);
  return lines.join("\n");
}

// 新会话的占位标题;首条消息发出后由 ChatView 改成截断的输入内容(ChatGPT 式)。
export const DEFAULT_CONVERSATION_TITLE = "新对话";

const ACTIVE_KEY = "lang-agent.activeConversation";

export function getActiveConversationId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveConversationId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function clearActiveConversationId(): void {
  localStorage.removeItem(ACTIVE_KEY);
}

// 最近活动在前(updated_at 倒序),给侧边栏列表用。
export async function listConversations(): Promise<ConversationMeta[]> {
  return db.select().from(conversation).orderBy(desc(conversation.updatedAt));
}

export async function getConversation(
  id: string,
): Promise<ConversationMeta | null> {
  const [row] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  return row ?? null;
}

export async function createConversation(
  title: string = DEFAULT_CONVERSATION_TITLE,
  id: string = crypto.randomUUID(),
  opts: { kind?: ConversationKind; learningAgentId?: string | null } = {},
): Promise<string> {
  const now = Date.now();
  await db.insert(conversation).values({
    id,
    title: title.trim() || DEFAULT_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    kind: opts.kind ?? "practice",
    learningAgentId: opts.learningAgentId ?? null,
  });
  return id;
}

export async function createPendingDerivedConversation(opts: {
  parentId: string;
  actionId: string;
  actionLabel: string;
  branchKind: BranchKind;
  sourceTurnId?: string | null;
  baseModifiers?: AgentModifiers;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const modifiers: AgentModifiers = {
    ...(opts.baseModifiers ?? {}),
    derivation: {
      actionId: opts.actionId,
      actionLabel: opts.actionLabel,
      status: "pending",
      sourceTurnId: opts.sourceTurnId ?? null,
      createdAt: now,
    },
  };
  await db.insert(conversation).values({
    id,
    title: `${opts.actionLabel} · 生成中`,
    createdAt: now,
    updatedAt: now,
    kind: "practice",
    learningAgentId: null,
    parentConversationId: opts.parentId,
    branchSourceTurnId: opts.sourceTurnId ?? null,
    branchKind: opts.branchKind,
    agentModifiersJson: JSON.stringify(modifiers),
  });
  // 衍生是非破坏式动作:原会话保持不变,不更新其修改时间/排序。
  return id;
}

export async function completeDerivedConversation(
  id: string,
  context: NewConversationContext,
): Promise<void> {
  const conv = await getConversation(id);
  const modifiers = parseAgentModifiers(conv?.agentModifiersJson ?? null);
  const now = Date.now();
  await db
    .update(conversation)
    .set({
      title: context.title.trim() || conv?.title || DEFAULT_CONVERSATION_TITLE,
      updatedAt: now,
      agentModifiersJson: JSON.stringify({
        ...modifiers,
        derivedContext: context,
        derivation: modifiers.derivation
          ? {
              ...modifiers.derivation,
              status: "ready",
              completedAt: now,
              error: null,
            }
          : undefined,
      } satisfies AgentModifiers),
    })
    .where(eq(conversation.id, id));
}

export async function failDerivedConversation(
  id: string,
  error: string,
): Promise<void> {
  const conv = await getConversation(id);
  const modifiers = parseAgentModifiers(conv?.agentModifiersJson ?? null);
  // 标题随状态改为「… · 生成失败」,避免侧栏永远停在「生成中」。
  const label = modifiers.derivation?.actionLabel ?? "衍生对话";
  await db
    .update(conversation)
    .set({
      title: `${label} · 生成失败`,
      updatedAt: Date.now(),
      agentModifiersJson: JSON.stringify({
        ...modifiers,
        derivation: modifiers.derivation
          ? { ...modifiers.derivation, status: "failed", error }
          : undefined,
      } satisfies AgentModifiers),
    })
    .where(eq(conversation.id, id));
}

// 从一个已有会话派生分支。原会话不动(非破坏式),区别于 truncateConversationFrom。
// copyTurns: "all" 复制全部历史 / "none" 空白开始 / {upToTurnId} 复制到该轮(含)。
// 复制的 turn 拿到新 id 挂到分支下,保留 createdAt/批改,不重新跑导师(不影响 mastery)。
export async function createBranch(opts: {
  parentId: string;
  branchKind: BranchKind;
  title: string;
  modifiers?: AgentModifiers;
  copyTurns: "all" | "none" | { upToTurnId: string };
  sourceTurnId?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const mods =
    opts.modifiers && Object.keys(opts.modifiers).length > 0
      ? opts.modifiers
      : null;
  await db.insert(conversation).values({
    id,
    title: opts.title.trim() || DEFAULT_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    kind: "practice",
    learningAgentId: null,
    parentConversationId: opts.parentId,
    branchSourceTurnId: opts.sourceTurnId ?? null,
    branchKind: opts.branchKind,
    agentModifiersJson: mods ? JSON.stringify(mods) : null,
  });

  if (opts.copyTurns !== "none") {
    let rows: Turn[];
    if (opts.copyTurns === "all") {
      rows = await db
        .select()
        .from(turn)
        .where(eq(turn.conversationId, opts.parentId))
        .orderBy(asc(turn.createdAt));
    } else {
      const [mark] = await db
        .select({ createdAt: turn.createdAt })
        .from(turn)
        .where(eq(turn.id, opts.copyTurns.upToTurnId))
        .limit(1);
      rows = mark
        ? await db
            .select()
            .from(turn)
            .where(
              and(
                eq(turn.conversationId, opts.parentId),
                lte(turn.createdAt, mark.createdAt),
              ),
            )
            .orderBy(asc(turn.createdAt))
        : [];
    }
    for (const r of rows) {
      await db.insert(turn).values({
        id: crypto.randomUUID(),
        createdAt: r.createdAt,
        userInput: r.userInput,
        reply: r.reply,
        analysisJson: r.analysisJson,
        conversationId: id,
        explainCount: r.explainCount,
        bilingualCount: r.bilingualCount,
      });
    }
  }
  return id;
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<void> {
  await db
    .update(conversation)
    .set({ title: title.trim() || DEFAULT_CONVERSATION_TITLE })
    .where(eq(conversation.id, id));
}

// 把 updated_at 推到现在,使刚发过消息的会话排到列表顶部。
export async function touchConversation(id: string): Promise<void> {
  await db
    .update(conversation)
    .set({ updatedAt: Date.now() })
    .where(eq(conversation.id, id));
}

// 滚动摘要读写(自动压缩用)。summary 是会话老内容的目标语摘要,throughId 是已折叠进
// 摘要的最后一个 turn.id(水位)。代码维护,LLM 只产出摘要文本。
export async function getSummary(
  id: string,
): Promise<{ summary: string | null; throughId: string | null }> {
  const [row] = await db
    .select({
      summary: conversation.summary,
      throughId: conversation.summaryThroughId,
    })
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  return { summary: row?.summary ?? null, throughId: row?.throughId ?? null };
}

export async function setSummary(
  id: string,
  summary: string,
  throughId: string,
): Promise<void> {
  await db
    .update(conversation)
    .set({ summary, summaryThroughId: throughId })
    .where(eq(conversation.id, id));
}

// 「从此处开始」:舍弃某会话里「从 fromId 起(含)」的所有 turn——这条之后的对话全部丢弃。
// 只删 turn:掌握/档案是全局且独立存储的,不在此处理——已记入学习记忆的内容保留。
// 若删除范围越过滚动摘要水位(throughId 也被删),清空摘要,让上下文从剩余原文重建。
export async function truncateConversationFrom(
  id: string,
  fromId: string,
): Promise<void> {
  const [mark] = await db
    .select({ createdAt: turn.createdAt })
    .from(turn)
    .where(eq(turn.id, fromId))
    .limit(1);
  if (!mark) return;
  await db
    .delete(turn)
    .where(
      and(eq(turn.conversationId, id), gte(turn.createdAt, mark.createdAt)),
    );

  const [conv] = await db
    .select({ throughId: conversation.summaryThroughId })
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  if (!conv?.throughId) return;
  const [stillThere] = await db
    .select({ id: turn.id })
    .from(turn)
    .where(eq(turn.id, conv.throughId))
    .limit(1);
  if (!stillThere) {
    await db
      .update(conversation)
      .set({ summary: null, summaryThroughId: null })
      .where(eq(conversation.id, id));
  }
}

// 删除会话连同它的所有 turn。掌握/档案是全局的,不在此处理。
export async function deleteConversation(id: string): Promise<void> {
  await db.delete(turn).where(eq(turn.conversationId, id));
  await db.delete(conversation).where(eq(conversation.id, id));
}

// 启动时调用:返回应激活的会话 id。没有任何历史时返回 null,由前端显示未落库的新对话草稿。
// multi-conversation 之前遗留的 conversation_id 为 NULL 的旧 turn 仍会归档进一个默认会话。
export async function ensureActiveConversation(): Promise<string | null> {
  let convs = await listConversations();

  if (convs.length === 0) {
    const orphanCount = await countOrphanTurns();
    if (orphanCount === 0) {
      clearActiveConversationId();
      return null;
    }

    const id = await createConversation(DEFAULT_CONVERSATION_TITLE);
    const adopted = await adoptOrphanTurns(id);
    if (adopted > 0) {
      // 旧历史:用第一条输入做标题,并把时间对齐到最后一轮。
      const first = await firstOrphanAdoptedUserInput(id);
      if (first) await renameConversation(id, titleFromInput(first));
    }
    convs = await listConversations();
  }

  const saved = getActiveConversationId();
  if (saved && convs.some((c) => c.id === saved)) return saved;

  if (convs.length === 0) {
    clearActiveConversationId();
    return null;
  }

  const active = convs[0].id; // 最近活动的会话
  setActiveConversationId(active);
  return active;
}

async function countOrphanTurns(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(turn)
    .where(isNull(turn.conversationId));
  return row?.n ?? 0;
}

// 把所有 conversation_id 为 NULL 的 turn 归到指定会话。返回归档条数。
async function adoptOrphanTurns(conversationId: string): Promise<number> {
  const n = await countOrphanTurns();
  if (n > 0) {
    await db
      .update(turn)
      .set({ conversationId })
      .where(isNull(turn.conversationId));
  }
  return n;
}

async function firstOrphanAdoptedUserInput(
  conversationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userInput: turn.userInput })
    .from(turn)
    .where(eq(turn.conversationId, conversationId))
    .orderBy(turn.createdAt)
    .limit(1);
  return row?.userInput ?? null;
}

// 首条消息后自动命名:仅当标题仍是占位符时才改(用户手动改过的不动)。
export async function maybeAutoTitle(
  id: string,
  userInput: string,
): Promise<void> {
  const [row] = await db
    .select({ title: conversation.title })
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  if (row && row.title === DEFAULT_CONVERSATION_TITLE) {
    await renameConversation(id, titleFromInput(userInput));
  }
}

// 从用户首条输入派生会话标题:压缩空白、截断。
export function titleFromInput(text: string, max = 30): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_CONVERSATION_TITLE;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
