import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import { type AgentJob, agentJob } from "./schema";

export type AgentJobStatus = AgentJob["status"];
export type AgentJobSource = AgentJob["source"];

function payloadJson(payload: unknown): string | null {
  if (payload == null) return null;
  return JSON.stringify(payload);
}

export async function createAgentJob(input: {
  kind: string;
  source: AgentJobSource;
  input?: unknown;
  id?: string;
}): Promise<string> {
  const now = Date.now();
  const id = input.id ?? crypto.randomUUID();
  await db.insert(agentJob).values({
    id,
    kind: input.kind,
    status: "pending",
    inputJson: payloadJson(input.input),
    outputJson: null,
    error: null,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  });
  return id;
}

export async function listAgentJobs(limit = 50): Promise<AgentJob[]> {
  return db
    .select()
    .from(agentJob)
    .orderBy(desc(agentJob.updatedAt))
    .limit(limit);
}

export async function getAgentJob(id: string): Promise<AgentJob | null> {
  const [row] = await db
    .select()
    .from(agentJob)
    .where(eq(agentJob.id, id))
    .limit(1);
  return row ?? null;
}

async function setAgentJobStatus(
  id: string,
  patch: {
    status: AgentJobStatus;
    output?: unknown;
    error?: string | null;
    startedAt?: number | null;
    finishedAt?: number | null;
  },
): Promise<void> {
  const updates: Partial<typeof agentJob.$inferInsert> = {
    status: patch.status,
    updatedAt: Date.now(),
  };
  if (patch.output !== undefined)
    updates.outputJson = payloadJson(patch.output);
  if (patch.error !== undefined) updates.error = patch.error;
  if (patch.startedAt !== undefined) updates.startedAt = patch.startedAt;
  if (patch.finishedAt !== undefined) updates.finishedAt = patch.finishedAt;

  await db.update(agentJob).set(updates).where(eq(agentJob.id, id));
}

export async function runTrackedAgentJob<T>(
  input: { kind: string; source: AgentJobSource; input?: unknown },
  task: (jobId: string) => Promise<T>,
): Promise<{ jobId: string; result: T }> {
  const jobId = await createAgentJob(input);
  await setAgentJobStatus(jobId, {
    status: "running",
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  });

  try {
    const result = await task(jobId);
    await setAgentJobStatus(jobId, {
      status: "succeeded",
      output: result,
      error: null,
      finishedAt: Date.now(),
    });
    return { jobId, result };
  } catch (e) {
    await setAgentJobStatus(jobId, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      finishedAt: Date.now(),
    });
    throw e;
  }
}
