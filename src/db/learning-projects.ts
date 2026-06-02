import { desc, eq } from "drizzle-orm";
import { db } from "./client";
import { type LearningProject, learningProject } from "./schema";

export type { LearningProject };
export type LearningProjectStatus = LearningProject["status"];

function payloadJson(payload: unknown): string | null {
  if (payload == null) return null;
  return JSON.stringify(payload);
}

export async function createLearningProject(input: {
  title: string;
  goal: string;
  planMd: string;
  notesMd?: string | null;
  sourcePrompt?: string | null;
  taskPlan?: unknown;
  id?: string;
}): Promise<string> {
  const now = Date.now();
  const id = input.id ?? crypto.randomUUID();
  await db.insert(learningProject).values({
    id,
    title: input.title.trim(),
    goal: input.goal.trim(),
    status: "active",
    planMd: input.planMd.trim(),
    notesMd: input.notesMd?.trim() ?? "",
    sourcePrompt: input.sourcePrompt?.trim() || null,
    taskPlanJson: payloadJson(input.taskPlan),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function listLearningProjects(): Promise<LearningProject[]> {
  return db
    .select()
    .from(learningProject)
    .orderBy(desc(learningProject.updatedAt));
}

export async function getLearningProject(
  id: string,
): Promise<LearningProject | null> {
  const [row] = await db
    .select()
    .from(learningProject)
    .where(eq(learningProject.id, id))
    .limit(1);
  return row ?? null;
}

export async function updateLearningProject(
  id: string,
  patch: Partial<{
    title: string;
    goal: string;
    status: LearningProjectStatus;
    planMd: string;
    notesMd: string;
    taskPlan: unknown;
  }>,
): Promise<void> {
  const updates: Partial<typeof learningProject.$inferInsert> = {
    updatedAt: Date.now(),
  };
  if (patch.title !== undefined) updates.title = patch.title.trim();
  if (patch.goal !== undefined) updates.goal = patch.goal.trim();
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.planMd !== undefined) updates.planMd = patch.planMd.trim();
  if (patch.notesMd !== undefined) updates.notesMd = patch.notesMd.trim();
  if (patch.taskPlan !== undefined)
    updates.taskPlanJson = payloadJson(patch.taskPlan);

  await db
    .update(learningProject)
    .set(updates)
    .where(eq(learningProject.id, id));
}

export async function appendLearningProjectNotes(
  id: string,
  notes: string,
): Promise<void> {
  const project = await getLearningProject(id);
  if (!project) return;
  const clean = notes.trim();
  if (!clean) return;
  const next = project.notesMd.trim()
    ? `${project.notesMd.trim()}\n\n${clean}`
    : clean;
  await updateLearningProject(id, { notesMd: next });
}
