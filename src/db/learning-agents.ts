import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { type LearningAgent, learningAgent } from "./schema";

export const LEARNING_DATA_SCOPE_VALUES = [
  "profile",
  "weak_all",
  "weak_grammar",
  "expression_gaps",
  "today_turns",
  "due_review",
  "proficiency",
] as const;

export type LearningDataScope = (typeof LEARNING_DATA_SCOPE_VALUES)[number];

export interface LearningAgentDraft {
  name: string;
  description: string;
  prompt: string;
  dataScopes: LearningDataScope[];
}

export interface LearningAgentMeta extends LearningAgent {
  dataScopes: LearningDataScope[];
}

export const DATA_SCOPE_LABELS: Record<LearningDataScope, string> = {
  profile: "学习者档案: 兴趣、偏好、最近在练什么",
  weak_all: "薄弱项: 仍未掌握的词汇、语法、搭配、错误模式",
  weak_grammar: "语法/错误模式: 最近错过或仍薄弱的语法点",
  expression_gaps: "表达缺口: 用母语/混说时暴露出的“想说但说不出”",
  today_turns: "今日对话: 今天或最近 24 小时的练习内容和批改",
  due_review: "到期复习: 很久没重温的学习项",
  proficiency: "难度读数: 最近表现推断出的难度校准",
};

export const LEARNING_DATA_SCOPES = [...LEARNING_DATA_SCOPE_VALUES];

const BUILT_INS: (LearningAgentDraft & { id: string })[] = [
  {
    id: "builtin:daily_review",
    name: "今日复盘",
    description: "总结今天练过的内容,抓出最值得马上复习的 3 个点。",
    dataScopes: [
      "profile",
      "today_turns",
      "weak_all",
      "due_review",
      "proficiency",
    ],
    prompt: `Start by summarizing what the learner practiced today or in the recent session history. Then choose the 3 most useful review points.

For each point:
- Explain the pattern in the learner's native language when explanation helps.
- Give 1-2 concise target-language examples.
- Ask the learner to produce one short answer or sentence.

Keep the lesson focused. Do not turn this into a long report; make it actionable and conversational.`,
  },
  {
    id: "builtin:grammar_review",
    name: "语法专项复习",
    description: "按错误模式归纳最近错过的语法,给解释、例句和即时练习。",
    dataScopes: ["profile", "weak_grammar", "due_review", "proficiency"],
    prompt: `Focus on grammar and recurring error patterns. Group related mistakes instead of listing every item.

Begin with a short diagnosis: what grammar pattern is most worth reviewing now and why. Explain it like a teacher, using the learner's native language where that saves time, then show natural target-language examples.

After the explanation, run a small drill: ask for 2-3 short target-language sentences that force the learner to use the target pattern. Give feedback in the conversation rather than using the normal correction panel.`,
  },
  {
    id: "builtin:expression_gap_review",
    name: "表达缺口训练",
    description: "把“想说但说不出”的母语/混说内容变成可复用句型。",
    dataScopes: ["profile", "expression_gaps", "due_review", "proficiency"],
    prompt: `Focus on expression gaps: things the learner wanted to say but fell back to their native language or mixed language.

Pick one or two high-value situations. For each, teach the reusable target-language pattern, explain when to use it in the learner's native language, then ask the learner to produce a similar sentence.

Prioritize practical phrasing over abstract grammar terms. If there are no expression gaps yet, teach one useful pattern related to their profile/interests and ask them to try it.`,
  },
];

function parseScopes(json: string): LearningDataScope[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return ["weak_all"];
    const allowed = new Set<LearningDataScope>(LEARNING_DATA_SCOPES);
    const scopes = raw.filter(
      (v): v is LearningDataScope =>
        typeof v === "string" && allowed.has(v as LearningDataScope),
    );
    return scopes.length ? scopes : ["weak_all"];
  } catch {
    return ["weak_all"];
  }
}

function serializeScopes(scopes: LearningDataScope[]): string {
  const allowed = new Set<LearningDataScope>(LEARNING_DATA_SCOPES);
  const clean = scopes.filter((s) => allowed.has(s));
  return JSON.stringify(clean.length ? clean : ["weak_all"]);
}

function hydrate(row: LearningAgent): LearningAgentMeta {
  return { ...row, dataScopes: parseScopes(row.dataScopeJson) };
}

export async function ensureBuiltInLearningAgents(): Promise<void> {
  const now = Date.now();
  for (const item of BUILT_INS) {
    const [existing] = await db
      .select({ id: learningAgent.id })
      .from(learningAgent)
      .where(eq(learningAgent.id, item.id))
      .limit(1);
    if (existing) continue;
    await db.insert(learningAgent).values({
      id: item.id,
      name: item.name,
      description: item.description,
      prompt: item.prompt,
      dataScopeJson: serializeScopes(item.dataScopes),
      builtIn: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function listLearningAgents(): Promise<LearningAgentMeta[]> {
  const rows = await db
    .select()
    .from(learningAgent)
    .orderBy(desc(learningAgent.builtIn), asc(learningAgent.createdAt));
  return rows.map(hydrate);
}

export async function getLearningAgent(
  id: string,
): Promise<LearningAgentMeta | null> {
  const [row] = await db
    .select()
    .from(learningAgent)
    .where(eq(learningAgent.id, id))
    .limit(1);
  return row ? hydrate(row) : null;
}

export async function createLearningAgent(
  draft: LearningAgentDraft,
  id = crypto.randomUUID(),
): Promise<string> {
  const now = Date.now();
  await db.insert(learningAgent).values({
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    prompt: draft.prompt.trim(),
    dataScopeJson: serializeScopes(draft.dataScopes),
    builtIn: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateLearningAgent(
  id: string,
  patch: Partial<LearningAgentDraft>,
): Promise<void> {
  const updates: Partial<typeof learningAgent.$inferInsert> = {
    updatedAt: Date.now(),
  };
  if (patch.name !== undefined) updates.name = patch.name.trim();
  if (patch.description !== undefined)
    updates.description = patch.description.trim();
  if (patch.prompt !== undefined) updates.prompt = patch.prompt.trim();
  if (patch.dataScopes !== undefined)
    updates.dataScopeJson = serializeScopes(patch.dataScopes);

  await db.update(learningAgent).set(updates).where(eq(learningAgent.id, id));
}

export async function deleteLearningAgent(id: string): Promise<void> {
  await db
    .delete(learningAgent)
    .where(and(eq(learningAgent.id, id), eq(learningAgent.builtIn, 0)));
}
