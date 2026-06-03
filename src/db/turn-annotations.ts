import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import { type TurnAnnotation, turnAnnotation } from "./schema";

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
    title: input.title.trim() || "观察结果",
    bodyMd: input.bodyMd.trim(),
    payloadJson: payloadJson(input.payload),
    createdAt: Date.now(),
  });
  return id;
}

export async function listTurnAnnotations(
  turnId: string,
): Promise<TurnAnnotation[]> {
  return db
    .select()
    .from(turnAnnotation)
    .where(eq(turnAnnotation.turnId, turnId))
    .orderBy(desc(turnAnnotation.createdAt));
}
