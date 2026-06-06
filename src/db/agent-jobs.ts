import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "./client";
import { type AgentJob, agentJob } from "./schema";

export type AgentJobStatus = AgentJob["status"];
export type AgentJobSource = AgentJob["source"];

export interface AgentJobFilter {
  source?: AgentJobSource;
  status?: AgentJobStatus;
}

function whereForFilter(filter: AgentJobFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.source) clauses.push(eq(agentJob.source, filter.source));
  if (filter.status) clauses.push(eq(agentJob.status, filter.status));
  return clauses.length ? and(...clauses) : undefined;
}

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

// Write a single "completed" agent run log entry (semantically an agent_run). Used on the hot path:
// fire-and-forget after the run finishes, single insert, no pre-LLM row insertion. Tokens not recorded yet (provider interface does not expose them).
export async function recordAgentRun(run: {
  kind: string; // hook name, e.g. "conversation.reply"
  source: AgentJobSource;
  agentId?: string;
  turnId?: string;
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string | null;
  startedAt: number;
  finishedAt: number;
}): Promise<void> {
  await db.insert(agentJob).values({
    id: crypto.randomUUID(),
    kind: run.kind,
    status: run.status,
    inputJson: run.agentId ? JSON.stringify({ agentId: run.agentId }) : null,
    outputJson: payloadJson(run.output),
    error: run.error ?? null,
    source: run.source,
    turnId: run.turnId ?? null,
    createdAt: run.startedAt,
    updatedAt: run.finishedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
}

export async function listAgentJobs(limit = 50): Promise<AgentJob[]> {
  return db
    .select()
    .from(agentJob)
    .orderBy(desc(agentJob.updatedAt))
    .limit(limit);
}

// Settings · Logs page: filter by source/status + pagination (Drizzle limit/offset). listAgentJobs still serves
// the old "most recent N" use case; paged query and count are separate functions to avoid changing existing signatures.
export async function listAgentJobsPage(opts: {
  limit: number;
  offset: number;
  source?: AgentJobSource;
  status?: AgentJobStatus;
}): Promise<AgentJob[]> {
  return db
    .select()
    .from(agentJob)
    .where(whereForFilter(opts))
    .orderBy(desc(agentJob.updatedAt))
    .limit(opts.limit)
    .offset(opts.offset);
}

export async function countAgentJobs(
  filter: AgentJobFilter = {},
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(agentJob)
    .where(whereForFilter(filter));
  return row?.value ?? 0;
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
