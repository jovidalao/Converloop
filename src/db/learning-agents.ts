import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { type LearningAgent, learningAgent } from "./schema";

export const LEARNING_DATA_SCOPE_VALUES = [
  "profile",
  "comfortable",
  "weak_all",
  "weak_grammar",
  "expression_gaps",
  "today_turns",
  "due_review",
  "proficiency",
] as const;

export type LearningDataScope = (typeof LEARNING_DATA_SCOPE_VALUES)[number];

export const LEARNING_AGENT_KIND_VALUES = [
  "lesson",
  "observer",
  "action",
] as const;

export type LearningAgentKind = (typeof LEARNING_AGENT_KIND_VALUES)[number];

export const RUNTIME_AGENT_HOOK_VALUES = [
  "conversation.observe",
  "conversation.action",
] as const;

export type RuntimeAgentHook = (typeof RUNTIME_AGENT_HOOK_VALUES)[number];

export const LEARNING_AGENT_TOOL_VALUES = ["read_learning_data"] as const;

export type LearningAgentTool = (typeof LEARNING_AGENT_TOOL_VALUES)[number];

export const LEARNING_AGENT_WRITEBACK_POLICY_VALUES = [
  "none",
  "propose_review_signals",
] as const;

export type LearningAgentWritebackPolicy =
  (typeof LEARNING_AGENT_WRITEBACK_POLICY_VALUES)[number];

export interface LearningAgentDraft {
  name: string;
  description: string;
  prompt: string;
  dataScopes: LearningDataScope[];
  kind?: LearningAgentKind;
  hook?: RuntimeAgentHook | null;
  enabled?: boolean;
  version?: number;
  allowedTools?: LearningAgentTool[];
  writebackPolicy?: LearningAgentWritebackPolicy;
  outputSchema?: Record<string, unknown> | null;
  packageMeta?: LearningAgentPackageMeta | null;
}

export interface LearningAgentPackageMeta {
  format: string;
  packageId: string;
  packageVersion: string;
  packageItemId: string;
  sourceUrl?: string | null;
  contentHash?: string | null;
  installedAt: number;
}

export interface LearningAgentMeta extends LearningAgent {
  dataScopes: LearningDataScope[];
  kind: LearningAgentKind;
  hook: RuntimeAgentHook | null;
  enabled: number;
  allowedTools: LearningAgentTool[];
  writebackPolicy: LearningAgentWritebackPolicy;
  outputSchema: Record<string, unknown> | null;
  packageMeta: LearningAgentPackageMeta | null;
}

export const DATA_SCOPE_LABELS: Record<LearningDataScope, string> = {
  profile:
    "Learner profile: interests, preferences, what they are currently practising",
  comfortable:
    "Mastered scaffolding: expressions, grammar, collocations safe to reuse and transfer",
  weak_all:
    "Weak points: vocabulary, grammar, collocations, and error patterns not yet mastered",
  weak_grammar:
    "Grammar / error patterns: recently missed or still-weak grammar points",
  expression_gaps:
    "Expression gaps: things wanted to say but fell back to native language or mixed speech",
  today_turns:
    "Today's conversations: practice content and corrections from the last 24 hours",
  due_review: "Due for review: learning items not revisited for a long time",
  proficiency:
    "Difficulty reading: difficulty calibration inferred from recent performance",
};

export const LEARNING_DATA_SCOPES = [...LEARNING_DATA_SCOPE_VALUES];

export const DEFAULT_LEARNING_AGENT_VERSION = 1;
export const DEFAULT_LEARNING_AGENT_WRITEBACK_POLICY = "none";

function normalizeKind(kind: string | undefined): LearningAgentKind {
  return LEARNING_AGENT_KIND_VALUES.includes(kind as LearningAgentKind)
    ? (kind as LearningAgentKind)
    : "lesson";
}

function normalizeHook(
  hook: string | null | undefined,
  kind: LearningAgentKind,
): RuntimeAgentHook | null {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  if (hook && RUNTIME_AGENT_HOOK_VALUES.includes(hook as RuntimeAgentHook)) {
    return hook as RuntimeAgentHook;
  }
  return null;
}

interface BuiltInAgent extends LearningAgentDraft {
  id: string;
  // Previously published versions that this built-in supersedes. On startup, if the user's row still
  // matches one of these (i.e. it was never edited), upgrade to the latest seed; if none match (user has customized), leave it untouched.
  supersedes?: LearningAgentDraft[];
}

const BUILT_INS: BuiltInAgent[] = [
  {
    id: "builtin:daily_review",
    name: "Daily review",
    description:
      "Opens with a today's practice report, then guides you through the top points to revisit.",
    dataScopes: [
      "profile",
      "comfortable",
      "today_turns",
      "weak_all",
      "due_review",
      "proficiency",
    ],
    prompt: `On the FIRST message of the session, open with a detailed review report of what the learner practiced today. Use the data tagged as today; if there is none, fall back to the recent session history. Write it as clear Markdown the learner can scan:

1. **今日概览** — how many exchanges, the main topics/situations practiced. Summarize in the learner's native language.
2. **做得好的地方** — 1-3 concrete strengths, each with a short target-language example pulled from today.
3. **需要注意的问题** — group today's corrections and weak items into a short list or table: the pattern, what the learner wrote, the natural version, and a one-line explanation in the native language.
4. **最该复习的 3 个点** — pick the 3 highest-value items, each with a one-line why.

Keep the report accurate to the data shown; do not invent practice that is not there. If there is no practice today, say so plainly and instead report on the most relevant due-for-review and weak items.

AFTER the report, transition into practice: take the first of the Top 3 points, give 1-2 target-language examples, and ask the learner to produce one short sentence. From then on keep it focused and conversational — give feedback directly in the chat.`,
    supersedes: [
      {
        name: "Daily review",
        description:
          "Summarizes what you practised today and picks the 3 points most worth reviewing right now.",
        dataScopes: [
          "profile",
          "comfortable",
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
    ],
  },
  {
    id: "builtin:grammar_review",
    name: "Grammar drill",
    description:
      "Explains each recent grammar mistake one by one, then drills them until they stick.",
    dataScopes: [
      "profile",
      "comfortable",
      "weak_grammar",
      "due_review",
      "proficiency",
    ],
    prompt: `On the FIRST message of the session, walk through the learner's RECENT grammar mistakes and recurring error patterns. Focus on what they got wrong most recently — the data is ordered newest-first — not old history. Cover EVERY recent grammar issue shown; only merge mistakes that are genuinely the same pattern. Write it as clear Markdown the learner can scan:

1. **最近的语法问题** — a numbered list, one entry per recent grammar issue. For each: name the pattern, show how the learner wrote it (wrong) vs. the natural form, and a one-line explanation of the underlying rule in the learner's native language.
2. **逐个击破的顺序** — list the order you will drill these in this session (most foundational first), so the learner knows the plan.

Keep the report grounded in the data shown; do not invent mistakes. If there is little grammar data, explain what little exists and pick one useful pattern matched to the learner's level/profile.

AFTER the report, drill the issues ONE AT A TIME (逐个击破): start with the first, give 1-2 target-language examples, then ask for 2-3 short sentences that force the learner to use it. Only move on to the next issue once the current one is solid, and tell the learner when you do (e.g. "✅ 第 1 个搞定,下一个"). Give feedback directly in the chat rather than using the normal correction panel.`,
    supersedes: [
      {
        name: "Grammar drill",
        description:
          "Opens with a grammar diagnostic report, then runs a focused drill on the highest-priority point.",
        dataScopes: [
          "profile",
          "comfortable",
          "weak_grammar",
          "due_review",
          "proficiency",
        ],
        prompt: `On the FIRST message of the session, open with a detailed grammar diagnostic report based on the learner's grammar and recurring error patterns. Group related mistakes instead of listing every item. Write it as clear Markdown:

1. **语法体检** — 2-4 grammar patterns most worth reviewing now, ordered by impact. For each: name the pattern, show 1-2 examples of how the learner currently gets it wrong vs. the natural form, and a one-line explanation in the native language of the underlying rule.
2. **优先级** — say which one pattern to drill first this session and why (how frequent, how basic, or how overdue for review).

Keep the report grounded in the data shown; do not invent mistakes. If there is little grammar data, report on what little exists and pick one useful pattern matched to the learner's level/profile.

AFTER the report, run a small drill on the top-priority pattern: ask for 2-3 short target-language sentences that force the learner to use it. Give feedback directly in the chat rather than using the normal correction panel.`,
      },
      {
        name: "Grammar drill",
        description:
          "Groups recent grammar mistakes by error pattern, with explanations, examples, and immediate practice.",
        dataScopes: [
          "profile",
          "comfortable",
          "weak_grammar",
          "due_review",
          "proficiency",
        ],
        prompt: `Focus on grammar and recurring error patterns. Group related mistakes instead of listing every item.

Begin with a short diagnosis: what grammar pattern is most worth reviewing now and why. Explain it like a teacher, using the learner's native language where that saves time, then show natural target-language examples.

After the explanation, run a small drill: ask for 2-3 short target-language sentences that force the learner to use the target pattern. Give feedback in the conversation rather than using the normal correction panel.`,
      },
    ],
  },
  {
    id: "builtin:expression_gap_review",
    name: "Expression gap training",
    description:
      "Turns native-language or mixed-language fallback moments into reusable target-language patterns.",
    dataScopes: [
      "profile",
      "comfortable",
      "expression_gaps",
      "due_review",
      "proficiency",
    ],
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

function parseTools(json: string): LearningAgentTool[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    const allowed = new Set<LearningAgentTool>(LEARNING_AGENT_TOOL_VALUES);
    return raw.filter(
      (v): v is LearningAgentTool =>
        typeof v === "string" && allowed.has(v as LearningAgentTool),
    );
  } catch {
    return [];
  }
}

function serializeTools(tools: LearningAgentTool[] | undefined): string {
  const allowed = new Set<LearningAgentTool>(LEARNING_AGENT_TOOL_VALUES);
  const clean = (tools ?? []).filter((tool) => allowed.has(tool));
  return JSON.stringify(clean);
}

function normalizeWritebackPolicy(
  policy: string | undefined,
): LearningAgentWritebackPolicy {
  return LEARNING_AGENT_WRITEBACK_POLICY_VALUES.includes(
    policy as LearningAgentWritebackPolicy,
  )
    ? (policy as LearningAgentWritebackPolicy)
    : DEFAULT_LEARNING_AGENT_WRITEBACK_POLICY;
}

function parseOutputSchema(
  json: string | null,
): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function serializeOutputSchema(
  schema: Record<string, unknown> | null | undefined,
): string | null {
  return schema ? JSON.stringify(schema) : null;
}

function parsePackageMeta(
  json: string | null,
): LearningAgentPackageMeta | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const meta = raw as Record<string, unknown>;
    if (
      typeof meta.format !== "string" ||
      typeof meta.packageId !== "string" ||
      typeof meta.packageVersion !== "string" ||
      typeof meta.packageItemId !== "string" ||
      typeof meta.installedAt !== "number"
    ) {
      return null;
    }
    return {
      format: meta.format,
      packageId: meta.packageId,
      packageVersion: meta.packageVersion,
      packageItemId: meta.packageItemId,
      sourceUrl:
        typeof meta.sourceUrl === "string" ? meta.sourceUrl : undefined,
      contentHash:
        typeof meta.contentHash === "string" ? meta.contentHash : undefined,
      installedAt: meta.installedAt,
    };
  } catch {
    return null;
  }
}

function serializePackageMeta(
  meta: LearningAgentPackageMeta | null | undefined,
): string | null {
  return meta ? JSON.stringify(meta) : null;
}

function hydrate(row: LearningAgent): LearningAgentMeta {
  const kind = normalizeKind(row.kind);
  return {
    ...row,
    kind,
    hook: normalizeHook(row.hook, kind),
    dataScopes: parseScopes(row.dataScopeJson),
    allowedTools: parseTools(row.allowedToolsJson),
    writebackPolicy: normalizeWritebackPolicy(row.writebackPolicy),
    outputSchema: parseOutputSchema(row.outputSchemaJson),
    packageMeta: parsePackageMeta(row.packageMetaJson),
  };
}

// Fingerprint of a built-in's "release version": name/description/prompt/scope must all match to count as the same version.
// Used to determine whether the user has edited the row — if so, do not overwrite; if not (matches a historical version), upgrade.
function seedSignature(draft: LearningAgentDraft): string {
  return JSON.stringify([
    draft.name,
    draft.description,
    draft.prompt,
    serializeScopes(draft.dataScopes),
  ]);
}

function rowSignature(row: LearningAgent): string {
  return JSON.stringify([
    row.name,
    row.description,
    row.prompt,
    row.dataScopeJson,
  ]);
}

export async function ensureBuiltInLearningAgents(): Promise<void> {
  const now = Date.now();
  for (const item of BUILT_INS) {
    const [existing] = await db
      .select()
      .from(learningAgent)
      .where(eq(learningAgent.id, item.id))
      .limit(1);

    if (!existing) {
      await db.insert(learningAgent).values({
        id: item.id,
        name: item.name,
        description: item.description,
        prompt: item.prompt,
        dataScopeJson: serializeScopes(item.dataScopes),
        version: item.version ?? DEFAULT_LEARNING_AGENT_VERSION,
        allowedToolsJson: serializeTools(item.allowedTools),
        writebackPolicy: normalizeWritebackPolicy(item.writebackPolicy),
        outputSchemaJson: serializeOutputSchema(item.outputSchema),
        builtIn: 1,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const current = seedSignature(item);
    const row = rowSignature(existing);
    if (row === current) continue; // already up to date

    const retired = (item.supersedes ?? []).map(seedSignature);
    if (!retired.includes(row)) continue; // user has customized it, leave it alone

    // Still on an old release version, not edited → upgrade to the latest seed.
    await db
      .update(learningAgent)
      .set({
        name: item.name,
        description: item.description,
        prompt: item.prompt,
        dataScopeJson: serializeScopes(item.dataScopes),
        version: item.version ?? DEFAULT_LEARNING_AGENT_VERSION,
        allowedToolsJson: serializeTools(item.allowedTools),
        writebackPolicy: normalizeWritebackPolicy(item.writebackPolicy),
        outputSchemaJson: serializeOutputSchema(item.outputSchema),
        updatedAt: now,
      })
      .where(eq(learningAgent.id, item.id));
  }
}

export async function listLearningAgents(): Promise<LearningAgentMeta[]> {
  const rows = await db
    .select()
    .from(learningAgent)
    .where(eq(learningAgent.kind, "lesson"))
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
  const kind = normalizeKind(draft.kind);
  await db.insert(learningAgent).values({
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    prompt: draft.prompt.trim(),
    dataScopeJson: serializeScopes(draft.dataScopes),
    kind,
    hook: normalizeHook(draft.hook, kind),
    enabled: draft.enabled === false ? 0 : 1,
    version: draft.version ?? DEFAULT_LEARNING_AGENT_VERSION,
    allowedToolsJson: serializeTools(draft.allowedTools),
    writebackPolicy: normalizeWritebackPolicy(draft.writebackPolicy),
    outputSchemaJson: serializeOutputSchema(draft.outputSchema),
    packageMetaJson: serializePackageMeta(draft.packageMeta),
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
  if (patch.kind !== undefined) {
    const kind = normalizeKind(patch.kind);
    updates.kind = kind;
    updates.hook = normalizeHook(patch.hook, kind);
  } else if (patch.hook !== undefined) {
    updates.hook = normalizeHook(patch.hook, "lesson");
  }
  if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
  if (patch.version !== undefined) updates.version = patch.version;
  if (patch.allowedTools !== undefined)
    updates.allowedToolsJson = serializeTools(patch.allowedTools);
  if (patch.writebackPolicy !== undefined)
    updates.writebackPolicy = normalizeWritebackPolicy(patch.writebackPolicy);
  if (patch.outputSchema !== undefined)
    updates.outputSchemaJson = serializeOutputSchema(patch.outputSchema);
  if (patch.packageMeta !== undefined)
    updates.packageMetaJson = serializePackageMeta(patch.packageMeta);

  await db.update(learningAgent).set(updates).where(eq(learningAgent.id, id));
}

export async function deleteLearningAgent(id: string): Promise<void> {
  await db
    .delete(learningAgent)
    .where(and(eq(learningAgent.id, id), eq(learningAgent.builtIn, 0)));
}

export async function listRuntimeLearningAgents(): Promise<
  LearningAgentMeta[]
> {
  const rows = await db
    .select()
    .from(learningAgent)
    .where(eq(learningAgent.enabled, 1))
    .orderBy(asc(learningAgent.createdAt));
  return rows
    .map(hydrate)
    .filter((a) => a.kind === "observer" || a.kind === "action");
}

export async function setLearningAgentEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await db
    .update(learningAgent)
    .set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
    .where(eq(learningAgent.id, id));
}
