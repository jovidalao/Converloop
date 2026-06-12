// Drill-scoped observer (# Observer section): runs in parallel after each learner answer in that
// drill's sessions and posts a short note to the coach panel as a turn annotation. Memory writes are
// proposal-only (writeback: propose) and always require user confirmation — same guarantee as custom
// observer agents; a drill document can never touch learning memory directly.

import { z } from "zod";
import { DataEditOperation } from "../agents/data-editor";
import { toJsonSchema } from "../agents/json-schema";
import { parseLLMJson } from "../agents/parse-llm-json";
import { loadConfig } from "../config";
import {
  LEARNING_DATA_SCOPE_VALUES,
  type LearningDataScope,
} from "../db/learning-agents";
import { createMemoryProposal } from "../db/memory-proposals";
import { createTurnAnnotation } from "../db/turn-annotations";
import type { ResolvedDrill } from "../drills/types";
import { buildLearningDataContext } from "../learning-data";
import type { ChatMessage } from "../providers/types";
import type { PracticeContext } from "./types";

const DrillObserverOutput = z.object({
  title: z.string().min(1),
  body_md: z.string().min(1),
  proposal_summary: z.string().optional(),
  memory_proposals: z.array(DataEditOperation).optional().default([]),
});

function validScopes(scopes: string[] | undefined): LearningDataScope[] {
  const allowed = new Set<string>(LEARNING_DATA_SCOPE_VALUES);
  return (scopes ?? []).filter((s): s is LearningDataScope => allowed.has(s));
}

export function drillObserverAgentId(modeId: string): string {
  return `drill:${modeId}:observer`;
}

export async function runDrillObserver(
  ctx: PracticeContext,
  drill: ResolvedDrill,
  instructions: string,
): Promise<void> {
  let turnId: string;
  try {
    turnId = await ctx.turnPersisted;
  } catch {
    return;
  }

  const dataContext = await buildLearningDataContext(
    { dataScopes: validScopes(drill.def.observerScopes) },
    loadConfig(),
  );
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are the observer agent of a training mode ("${drill.def.name}") in a language-learning app.

Your job is to inspect the learner's latest answer in this drill and produce a short visible note for the Coach Panel.
Follow the training mode's observer instructions exactly, but stay inside the output schema.

Rules:
- Return JSON only.
- Do not claim you changed learning memory directly.
- If you suggest memory writes, put them in memory_proposals using only create/update/delete/merge
  operations. For merge, key is the duplicate/source key and target_key is the canonical/target key.
- Use the learner's native language for explanations unless the observer instructions say otherwise.

=== OBSERVER INSTRUCTIONS ===
${instructions}`,
    },
    {
      role: "user",
      content: `=== LANGUAGES ===
Native: ${ctx.langs.nativeLanguage}
Target: ${ctx.langs.targetLanguage}
Level: ${ctx.langs.level}

=== LEARNING DATA YOU MAY READ ===
${dataContext.trim() || "(no learning data granted)"}

=== RECENT CONVERSATION ===
${ctx.tutorHistory || "(none)"}

=== CURRENT LEARNER ANSWER ===
${ctx.userInput}`,
    },
  ];

  const raw = await ctx.provider.generate({
    messages,
    temperature: 0.2,
    maxTokens: 2048,
    jsonSchema: toJsonSchema("DrillObserverOutput", DrillObserverOutput),
    meta: { label: drillObserverAgentId(drill.modeId) },
  });
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = DrillObserverOutput.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(
      `Drill observer output validation failed: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const output = validated.data;
  await createTurnAnnotation({
    turnId,
    agentId: drillObserverAgentId(drill.modeId),
    title: output.title,
    bodyMd: output.body_md,
    payload: output,
  });
  const proposals = (output.memory_proposals ?? []) as DataEditOperation[];
  if (drill.def.observerWriteback === "propose" && proposals.length > 0) {
    await createMemoryProposal({
      agentId: drillObserverAgentId(drill.modeId),
      turnId,
      summary: output.proposal_summary ?? output.title,
      operations: proposals,
    });
  }
}
