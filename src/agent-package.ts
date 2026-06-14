import { z } from "zod";
import {
  createLearningAgent,
  DATA_SCOPE_LABELS,
  LEARNING_AGENT_TOOL_VALUES,
  LEARNING_AGENT_WRITEBACK_POLICY_VALUES,
  LEARNING_DATA_SCOPE_VALUES,
  type LearningAgentDraft,
  type LearningAgentKind,
  type LearningAgentMeta,
  type LearningAgentPackageMeta,
  RUNTIME_AGENT_HOOK_VALUES,
} from "./db/learning-agents";
import { createLearningProject } from "./db/learning-projects";

const LEGACY_FORMAT = "lang-agent.agent-package";
const PACKAGE_FORMAT = "lang-agent.package";
const FORMAT_VERSION = 1;
const PACKAGE_SCHEMA_VERSION = 1;
const PACKAGE_AGENT_KIND_VALUES = ["observer", "action"] as const;

const PackageId = z.string().min(1).max(160);

const LegacyAgentPackageSchema = z.object({
  format: z.literal(LEGACY_FORMAT),
  version: z.literal(FORMAT_VERSION),
  agent: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    kind: z.enum(PACKAGE_AGENT_KIND_VALUES),
    hook: z.enum(RUNTIME_AGENT_HOOK_VALUES).nullable().optional(),
    dataScopes: z.array(z.enum(LEARNING_DATA_SCOPE_VALUES)).default([]),
    allowedTools: z.array(z.enum(LEARNING_AGENT_TOOL_VALUES)).default([]),
    writebackPolicy: z
      .enum(LEARNING_AGENT_WRITEBACK_POLICY_VALUES)
      .default("none"),
  }),
  files: z.object({
    "prompt.md": z.string().min(1),
    "schema.json": z.record(z.unknown()).nullable().optional(),
    "examples.json": z.array(z.unknown()).default([]),
  }),
});

const PackageBaseItem = z.object({
  id: PackageId,
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(240),
  prompt: z.string().min(1),
  dataScopes: z.array(z.enum(LEARNING_DATA_SCOPE_VALUES)).default([]),
  allowedTools: z.array(z.enum(LEARNING_AGENT_TOOL_VALUES)).default([]),
  writebackPolicy: z
    .enum(LEARNING_AGENT_WRITEBACK_POLICY_VALUES)
    .default("none"),
  outputSchema: z.record(z.unknown()).nullable().optional(),
  examples: z.array(z.unknown()).default([]),
});

const SkillPackageItemSchema = PackageBaseItem.extend({
  type: z.literal("skill"),
  kind: z.enum(PACKAGE_AGENT_KIND_VALUES),
  hook: z.enum(RUNTIME_AGENT_HOOK_VALUES).nullable().optional(),
});

const LessonPackageItemSchema = PackageBaseItem.extend({
  type: z.literal("lesson"),
});

const CourseLessonSchema = PackageBaseItem.omit({ id: true }).extend({
  id: PackageId,
});

const CoursePackageItemSchema = z.object({
  type: z.literal("course"),
  id: PackageId,
  title: z.string().min(1).max(120),
  goal: z.string().min(1).max(500),
  description: z.string().max(500).optional(),
  planMarkdown: z.string().min(1),
  notesMarkdown: z.string().optional(),
  lessons: z.array(CourseLessonSchema).min(1).max(20),
});

const SharePackageItemSchema = z.discriminatedUnion("type", [
  SkillPackageItemSchema,
  LessonPackageItemSchema,
  CoursePackageItemSchema,
]);

const SharePackageSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  version: z.literal(FORMAT_VERSION),
  package: z.object({
    id: PackageId,
    version: z.string().min(1).max(40).default("0.1.0"),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    author: z.string().max(120).optional(),
    license: z.string().max(80).optional(),
    homepage: z.string().max(300).optional(),
    tags: z.array(z.string().min(1).max(40)).default([]),
    targetLanguages: z.array(z.string().min(1).max(40)).default([]),
    nativeLanguages: z.array(z.string().min(1).max(40)).default([]),
    levels: z.array(z.string().min(1).max(20)).default([]),
  }),
  compatibility: z
    .object({
      schemaVersion: z
        .literal(PACKAGE_SCHEMA_VERSION)
        .default(PACKAGE_SCHEMA_VERSION),
      minAppVersion: z.string().max(40).optional(),
    })
    .default({ schemaVersion: PACKAGE_SCHEMA_VERSION }),
  items: z.array(SharePackageItemSchema).min(1).max(50),
});

export type AgentPackage = z.infer<typeof LegacyAgentPackageSchema>;
export type ShareAgentPackage = z.infer<typeof SharePackageSchema>;
export type SharePackageItem = ShareAgentPackage["items"][number];

export interface AgentPackageReview {
  name: string;
  kind: LearningAgentKind | "package";
  reads: string;
  writes: string;
  itemSummary: string;
  runtimeSkillCount: number;
  lessonCount: number;
  courseCount: number;
  items: AgentPackageReviewItem[];
}

export interface AgentPackageReviewItem {
  type: "skill" | "lesson" | "course";
  name: string;
  description: string;
  reads: string;
  writes: string;
  enabledByDefault: boolean;
}

export interface ImportAgentPackageOptions {
  enableRuntimeAgents?: boolean;
  enableLessons?: boolean;
  sourceUrl?: string | null;
}

export interface ImportAgentPackageResult {
  createdAgentIds: string[];
  createdProjectIds: string[];
  runtimeSkillCount: number;
  lessonCount: number;
  courseCount: number;
}

function hookForKind(kind: LearningAgentKind): AgentPackage["agent"]["hook"] {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  return null;
}

function slug(input: string): string {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "package";
}

async function sha256Hex(input: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function scopeLabels(scopes: readonly string[]): string {
  const labels = scopes
    .filter(
      (scope): scope is keyof typeof DATA_SCOPE_LABELS =>
        scope in DATA_SCOPE_LABELS,
    )
    .map((scope) => DATA_SCOPE_LABELS[scope].split(":")[0]);
  return [...new Set(labels)].join(" / ") || "No learning data";
}

function writePolicyLabel(policies: readonly string[]): string {
  return policies.includes("propose_review_signals")
    ? "Can propose learning data write-backs (requires confirmation)"
    : "No learning data writes";
}

function itemCounts(items: readonly SharePackageItem[]) {
  let runtimeSkillCount = 0;
  let lessonCount = 0;
  let courseCount = 0;
  for (const item of items) {
    if (item.type === "skill") runtimeSkillCount += 1;
    if (item.type === "lesson") lessonCount += 1;
    if (item.type === "course") {
      courseCount += 1;
      lessonCount += item.lessons.length;
    }
  }
  return { runtimeSkillCount, lessonCount, courseCount };
}

function packageMeta(input: {
  format: string;
  packageId: string;
  packageVersion: string;
  packageItemId: string;
  sourceUrl?: string | null;
  contentHash?: string | null;
}): LearningAgentPackageMeta {
  return {
    format: input.format,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    packageItemId: input.packageItemId,
    sourceUrl: input.sourceUrl ?? null,
    contentHash: input.contentHash ?? null,
    installedAt: Date.now(),
  };
}

export function defaultAgentOutputSchema(
  kind: LearningAgentKind,
): Record<string, unknown> | null {
  if (kind === "observer") {
    return {
      type: "object",
      required: ["title", "body_md"],
      properties: {
        title: { type: "string" },
        body_md: { type: "string" },
        proposal_summary: { type: "string" },
        memory_proposals: {
          type: "array",
          items: {
            type: "object",
            required: ["action", "key"],
            properties: {
              action: { enum: ["update", "delete", "create", "merge"] },
              key: { type: "string" },
              target_key: { type: "string" },
              label: { type: "string" },
              type: {
                enum: [
                  "vocab",
                  "grammar",
                  "collocation",
                  "error_pattern",
                  "expression_gap",
                ],
              },
              status: { enum: ["struggling", "learning", "known"] },
              example: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
            },
          },
        },
      },
    };
  }
  if (kind === "action") {
    return {
      type: "object",
      required: [
        "title",
        "scenario",
        "user_role",
        "ai_role",
        "difficulty",
        "opening_instruction",
      ],
      properties: {
        title: { type: "string" },
        scenario: { type: "string" },
        user_role: { type: "string" },
        ai_role: { type: "string" },
        difficulty: { type: "string" },
        continuity_summary: { type: "string" },
        opening_instruction: { type: "string" },
        constraints: {
          type: "array",
          items: { type: "string" },
        },
      },
    };
  }
  return null;
}

function itemFromAgent(agent: LearningAgentMeta): SharePackageItem {
  const base = {
    id: agent.packageMeta?.packageItemId ?? slug(agent.name),
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    dataScopes: agent.dataScopes,
    allowedTools: agent.allowedTools,
    writebackPolicy: agent.writebackPolicy,
    outputSchema: agent.outputSchema ?? defaultAgentOutputSchema(agent.kind),
    examples: [],
  };
  if (agent.kind === "lesson") {
    return { ...base, type: "lesson" };
  }
  // The package format predates reply transformers and has no slot for their icon / output mode / auto-run,
  // so sharing one would silently drop that config. Refuse rather than export a half-configured agent.
  if (agent.kind === "reply_transformer") {
    throw new Error("Sharing reply transformers is not supported yet");
  }
  return {
    ...base,
    type: "skill",
    kind: agent.kind,
    hook: agent.hook ?? hookForKind(agent.kind),
  };
}

function packageFromAgent(agent: LearningAgentMeta): ShareAgentPackage {
  const packageId =
    agent.packageMeta?.packageId ?? `local.${slug(agent.name)}.${agent.id}`;
  const packageVersion = agent.packageMeta?.packageVersion ?? "0.1.0";
  return {
    format: PACKAGE_FORMAT,
    version: FORMAT_VERSION,
    package: {
      id: packageId,
      version: packageVersion,
      name: agent.name,
      description: agent.description,
      tags: agent.kind === "lesson" ? ["lesson"] : ["skill", agent.kind],
      targetLanguages: [],
      nativeLanguages: [],
      levels: [],
    },
    compatibility: { schemaVersion: PACKAGE_SCHEMA_VERSION },
    items: [itemFromAgent(agent)],
  };
}

export async function exportAgentPackage(agentId: string): Promise<string> {
  const { getLearningAgent } = await import("./db/learning-agents");
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error("Agent not found");
  return JSON.stringify(packageFromAgent(agent), null, 2);
}

function reviewLegacy(raw: string): AgentPackageReview {
  const parsed = LegacyAgentPackageSchema.parse(JSON.parse(raw));
  const reads = scopeLabels(parsed.agent.dataScopes);
  const writes = writePolicyLabel([parsed.agent.writebackPolicy]);
  return {
    name: parsed.agent.name,
    kind: parsed.agent.kind,
    reads,
    writes,
    itemSummary: "1 skill",
    runtimeSkillCount: 1,
    lessonCount: 0,
    courseCount: 0,
    items: [
      {
        type: "skill",
        name: parsed.agent.name,
        description: parsed.agent.description,
        reads,
        writes,
        enabledByDefault: false,
      },
    ],
  };
}

function reviewShare(raw: string): AgentPackageReview {
  const parsed = SharePackageSchema.parse(JSON.parse(raw));
  const counts = itemCounts(parsed.items);
  const scopes: string[] = [];
  const policies: string[] = [];
  const items: AgentPackageReviewItem[] = [];
  for (const item of parsed.items) {
    if (item.type === "course") {
      items.push({
        type: "course",
        name: item.title,
        description: item.description ?? item.goal,
        reads: scopeLabels(item.lessons.flatMap((lesson) => lesson.dataScopes)),
        writes: writePolicyLabel(
          item.lessons.map((lesson) => lesson.writebackPolicy),
        ),
        enabledByDefault: true,
      });
      for (const lesson of item.lessons) {
        scopes.push(...lesson.dataScopes);
        policies.push(lesson.writebackPolicy);
        items.push({
          type: "lesson",
          name: lesson.name,
          description: lesson.description,
          reads: scopeLabels(lesson.dataScopes),
          writes: writePolicyLabel([lesson.writebackPolicy]),
          enabledByDefault: true,
        });
      }
      continue;
    }
    scopes.push(...item.dataScopes);
    policies.push(item.writebackPolicy);
    items.push({
      type: item.type,
      name: item.name,
      description: item.description,
      reads: scopeLabels(item.dataScopes),
      writes: writePolicyLabel([item.writebackPolicy]),
      enabledByDefault: item.type === "lesson",
    });
  }
  const parts = [
    counts.runtimeSkillCount ? `${counts.runtimeSkillCount} skill(s)` : null,
    counts.lessonCount ? `${counts.lessonCount} lesson(s)` : null,
    counts.courseCount ? `${counts.courseCount} course item(s)` : null,
  ].filter(Boolean);
  return {
    name: parsed.package.name,
    kind: "package",
    reads: scopeLabels(scopes),
    writes: writePolicyLabel(policies),
    itemSummary: parts.join(" · ") || "empty package",
    items,
    ...counts,
  };
}

export function reviewAgentPackage(raw: string): AgentPackageReview {
  const json = JSON.parse(raw) as unknown;
  const format =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>).format
      : null;
  if (format === LEGACY_FORMAT) return reviewLegacy(raw);
  return reviewShare(raw);
}

function draftFromSkill(
  item: z.infer<typeof SkillPackageItemSchema>,
  opts: {
    enabled: boolean;
    packageMeta: LearningAgentPackageMeta;
  },
): LearningAgentDraft {
  return {
    name: item.name,
    description: item.description,
    prompt: item.prompt,
    kind: item.kind,
    hook: item.hook ?? hookForKind(item.kind),
    dataScopes: item.dataScopes,
    allowedTools: item.allowedTools,
    writebackPolicy: item.kind === "observer" ? item.writebackPolicy : "none",
    outputSchema:
      item.outputSchema ?? defaultAgentOutputSchema(item.kind) ?? null,
    enabled: opts.enabled,
    packageMeta: opts.packageMeta,
  };
}

function draftFromLesson(
  item:
    | z.infer<typeof LessonPackageItemSchema>
    | z.infer<typeof CourseLessonSchema>,
  opts: {
    enabled: boolean;
    packageMeta: LearningAgentPackageMeta;
  },
): LearningAgentDraft {
  return {
    name: item.name,
    description: item.description,
    prompt: item.prompt,
    kind: "lesson",
    hook: null,
    dataScopes: item.dataScopes,
    allowedTools: item.allowedTools,
    writebackPolicy: item.writebackPolicy,
    outputSchema: item.outputSchema ?? null,
    enabled: opts.enabled,
    packageMeta: opts.packageMeta,
  };
}

async function importLegacyPackage(
  raw: string,
  opts: ImportAgentPackageOptions,
): Promise<ImportAgentPackageResult> {
  const parsed = LegacyAgentPackageSchema.parse(JSON.parse(raw));
  const contentHash = await sha256Hex(raw);
  const packageId = `legacy.${slug(parsed.agent.name)}`;
  const agentId = await createLearningAgent(
    draftFromSkill(
      {
        type: "skill",
        id: "agent",
        name: parsed.agent.name,
        description: parsed.agent.description,
        prompt: parsed.files["prompt.md"],
        kind: parsed.agent.kind,
        hook: parsed.agent.hook,
        dataScopes: parsed.agent.dataScopes,
        allowedTools: parsed.agent.allowedTools,
        writebackPolicy: parsed.agent.writebackPolicy,
        outputSchema: parsed.files["schema.json"] ?? null,
        examples: parsed.files["examples.json"],
      },
      {
        enabled: opts.enableRuntimeAgents ?? false,
        packageMeta: packageMeta({
          format: LEGACY_FORMAT,
          packageId,
          packageVersion: String(parsed.version),
          packageItemId: "agent",
          sourceUrl: opts.sourceUrl,
          contentHash,
        }),
      },
    ),
  );
  return {
    createdAgentIds: [agentId],
    createdProjectIds: [],
    runtimeSkillCount: 1,
    lessonCount: 0,
    courseCount: 0,
  };
}

async function importSharePackage(
  raw: string,
  opts: ImportAgentPackageOptions,
): Promise<ImportAgentPackageResult> {
  const parsed = SharePackageSchema.parse(JSON.parse(raw));
  const contentHash = await sha256Hex(raw);
  const createdAgentIds: string[] = [];
  const createdProjectIds: string[] = [];
  let runtimeSkillCount = 0;
  let lessonCount = 0;
  let courseCount = 0;
  const sourceUrl = opts.sourceUrl ?? parsed.package.homepage ?? null;

  for (const item of parsed.items) {
    if (item.type === "skill") {
      const id = await createLearningAgent(
        draftFromSkill(item, {
          enabled: opts.enableRuntimeAgents ?? false,
          packageMeta: packageMeta({
            format: PACKAGE_FORMAT,
            packageId: parsed.package.id,
            packageVersion: parsed.package.version,
            packageItemId: item.id,
            sourceUrl,
            contentHash,
          }),
        }),
      );
      createdAgentIds.push(id);
      runtimeSkillCount += 1;
      continue;
    }

    if (item.type === "lesson") {
      const id = await createLearningAgent(
        draftFromLesson(item, {
          enabled: opts.enableLessons ?? true,
          packageMeta: packageMeta({
            format: PACKAGE_FORMAT,
            packageId: parsed.package.id,
            packageVersion: parsed.package.version,
            packageItemId: item.id,
            sourceUrl,
            contentHash,
          }),
        }),
      );
      createdAgentIds.push(id);
      lessonCount += 1;
      continue;
    }

    const projectId = await createLearningProject({
      title: item.title,
      goal: item.goal,
      planMd: item.planMarkdown,
      notesMd: item.notesMarkdown ?? null,
      sourcePrompt: `Imported package ${parsed.package.id}@${parsed.package.version}`,
      taskPlan: {
        packageId: parsed.package.id,
        packageVersion: parsed.package.version,
        packageItemId: item.id,
      },
    });
    createdProjectIds.push(projectId);
    courseCount += 1;

    for (const lesson of item.lessons) {
      const id = await createLearningAgent(
        draftFromLesson(lesson, {
          enabled: opts.enableLessons ?? true,
          packageMeta: packageMeta({
            format: PACKAGE_FORMAT,
            packageId: parsed.package.id,
            packageVersion: parsed.package.version,
            packageItemId: `${item.id}/${lesson.id}`,
            sourceUrl,
            contentHash,
          }),
        }),
      );
      createdAgentIds.push(id);
      lessonCount += 1;
    }
  }

  return {
    createdAgentIds,
    createdProjectIds,
    runtimeSkillCount,
    lessonCount,
    courseCount,
  };
}

export async function importAgentPackage(
  raw: string,
  opts: ImportAgentPackageOptions = {},
): Promise<ImportAgentPackageResult> {
  const json = JSON.parse(raw) as unknown;
  const format =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>).format
      : null;
  if (format === LEGACY_FORMAT) return importLegacyPackage(raw, opts);
  return importSharePackage(raw, opts);
}
