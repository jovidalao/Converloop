import { count, desc, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { type Conversation, conversation, turn } from "./schema";

export type ConversationMeta = Conversation;
export type ConversationKind = Conversation["kind"];

// 新会话的占位标题;首条消息发出后由 ChatView 改成截断的输入内容(ChatGPT 式)。
export const DEFAULT_CONVERSATION_TITLE = "新对话";

const ACTIVE_KEY = "lang-agent.activeConversation";

export function getActiveConversationId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveConversationId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
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
  title = DEFAULT_CONVERSATION_TITLE,
  id = crypto.randomUUID(),
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

// 会话是否还没有任何 turn(空的「新对话」)。给新建按钮做去重判断用。
export async function isConversationEmpty(id: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(turn)
    .where(eq(turn.conversationId, id));
  return (row?.n ?? 0) === 0;
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

// 删除会话连同它的所有 turn。掌握/档案是全局的,不在此处理。
export async function deleteConversation(id: string): Promise<void> {
  await db.delete(turn).where(eq(turn.conversationId, id));
  await db.delete(conversation).where(eq(conversation.id, id));
}

// 启动时调用:确保至少有一个会话,并把 multi-conversation 之前遗留的
// (conversation_id 为 NULL 的)旧 turn 归档进一个默认会话。返回应激活的会话 id。
export async function ensureActiveConversation(): Promise<string> {
  let convs = await listConversations();

  if (convs.length === 0) {
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

  const active = convs[0].id; // 最近活动的会话
  setActiveConversationId(active);
  return active;
}

// 把所有 conversation_id 为 NULL 的 turn 归到指定会话。返回归档条数。
async function adoptOrphanTurns(conversationId: string): Promise<number> {
  const [before] = await db
    .select({ n: count() })
    .from(turn)
    .where(isNull(turn.conversationId));
  const n = before?.n ?? 0;
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
