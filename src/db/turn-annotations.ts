import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import { type TurnAnnotation, turn, turnAnnotation } from "./schema";

function payloadJson(payload: unknown): string | null {
  if (payload == null) return null;
  return JSON.stringify(payload);
}

export async function createTurnAnnotation(input: {
  turnId: string;
  agentId: string;
  title: string;
  bodyMd: string;
  payload?: unknown;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(turnAnnotation).values({
    id,
    turnId: input.turnId,
    agentId: input.agentId,
    title: input.title.trim() || "Observation",
    bodyMd: input.bodyMd.trim(),
    payloadJson: payloadJson(input.payload),
    createdAt: Date.now(),
  });
  return id;
}

// Conversation-scoped observations: join turn to gather every annotation across
// the conversation, for the Coach Panel's whole-conversation review.
export async function listTurnAnnotationsForConversation(
  conversationId: string,
): Promise<TurnAnnotation[]> {
  const rows = await db
    .select({ annotation: turnAnnotation })
    .from(turnAnnotation)
    .innerJoin(turn, eq(turnAnnotation.turnId, turn.id))
    .where(eq(turn.conversationId, conversationId))
    .orderBy(desc(turnAnnotation.createdAt));
  return rows.map((r) => r.annotation);
}
