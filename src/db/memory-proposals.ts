import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { DataEditOperation } from "../agents/data-editor";
import { applyDataEditOperations } from "../data-edit";
import { db } from "./client";
import { type MemoryProposal, memoryProposal } from "./schema";

const OperationListSchema = z.array(DataEditOperation);

function parseOperations(json: string): DataEditOperation[] {
  const raw = JSON.parse(json) as unknown;
  return OperationListSchema.parse(raw);
}

export async function createMemoryProposal(input: {
  agentId: string;
  turnId?: string | null;
  summary: string;
  operations: DataEditOperation[];
}): Promise<string | null> {
  const operations = OperationListSchema.parse(input.operations);
  if (operations.length === 0) return null;
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.insert(memoryProposal).values({
    id,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    agentId: input.agentId,
    turnId: input.turnId ?? null,
    summary: input.summary.trim() || "Agent 提议更新学习数据",
    operationsJson: JSON.stringify(operations),
    resultJson: null,
  });
  return id;
}

export async function listPendingMemoryProposals(
  turnId?: string | null,
): Promise<MemoryProposal[]> {
  const condition = turnId
    ? and(
        eq(memoryProposal.status, "pending"),
        eq(memoryProposal.turnId, turnId),
      )
    : eq(memoryProposal.status, "pending");
  return db
    .select()
    .from(memoryProposal)
    .where(condition)
    .orderBy(desc(memoryProposal.createdAt));
}

export function memoryProposalOperations(
  proposal: MemoryProposal,
): DataEditOperation[] {
  return parseOperations(proposal.operationsJson);
}

export async function applyMemoryProposal(id: string): Promise<{
  summary: string;
  applied: number;
  skipped: string[];
}> {
  const [row] = await db
    .select()
    .from(memoryProposal)
    .where(eq(memoryProposal.id, id))
    .limit(1);
  if (!row) throw new Error("找不到这条记忆提议");
  if (row.status !== "pending") throw new Error("这条记忆提议已处理");

  const operations = parseOperations(row.operationsJson);
  const result = await applyDataEditOperations(operations, row.summary);
  await db
    .update(memoryProposal)
    .set({
      status: "applied",
      updatedAt: Date.now(),
      resultJson: JSON.stringify(result),
    })
    .where(eq(memoryProposal.id, id));
  return result;
}

export async function dismissMemoryProposal(id: string): Promise<void> {
  await db
    .update(memoryProposal)
    .set({ status: "dismissed", updatedAt: Date.now() })
    .where(eq(memoryProposal.id, id));
}
