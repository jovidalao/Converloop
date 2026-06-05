import { z } from "zod";
import {
  createLearningAgent,
  DATA_SCOPE_LABELS,
  getLearningAgent,
  LEARNING_AGENT_TOOL_VALUES,
  LEARNING_AGENT_WRITEBACK_POLICY_VALUES,
  LEARNING_DATA_SCOPE_VALUES,
  type LearningAgentDraft,
  type LearningAgentKind,
  type LearningAgentMeta,
  RUNTIME_AGENT_HOOK_VALUES,
} from "./db/learning-agents";

const FORMAT = "lang-agent.agent-package";
const VERSION = 1;
const PACKAGE_AGENT_KIND_VALUES = ["observer", "action"] as const;

const AgentPackageSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
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

export type AgentPackage = z.infer<typeof AgentPackageSchema>;

function hookForKind(kind: LearningAgentKind): AgentPackage["agent"]["hook"] {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  return null;
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

function packageFromAgent(agent: LearningAgentMeta): AgentPackage {
  if (agent.kind === "lesson") throw new Error("专项课暂不支持从能力库导出包");
  const kind = agent.kind;
  return {
    format: FORMAT,
    version: VERSION,
    agent: {
      name: agent.name,
      description: agent.description,
      kind,
      hook: agent.hook ?? hookForKind(kind),
      dataScopes: agent.dataScopes,
      allowedTools: agent.allowedTools,
      writebackPolicy: agent.writebackPolicy,
    },
    files: {
      "prompt.md": agent.prompt,
      "schema.json": agent.outputSchema ?? defaultAgentOutputSchema(kind),
      "examples.json": [],
    },
  };
}

export async function exportAgentPackage(agentId: string): Promise<string> {
  const agent = await getLearningAgent(agentId);
  if (!agent) throw new Error("找不到这个 Agent");
  return JSON.stringify(packageFromAgent(agent), null, 2);
}

export function reviewAgentPackage(raw: string): {
  name: string;
  kind: LearningAgentKind;
  reads: string;
  writes: string;
} {
  const parsed = AgentPackageSchema.parse(JSON.parse(raw));
  return {
    name: parsed.agent.name,
    kind: parsed.agent.kind,
    reads:
      parsed.agent.dataScopes
        .map((scope) => DATA_SCOPE_LABELS[scope].split(":")[0])
        .join(" / ") || "无学习数据",
    writes:
      parsed.agent.writebackPolicy === "propose_review_signals"
        ? "可提出学习数据写入建议(需确认)"
        : "不写学习数据",
  };
}

export async function importAgentPackage(raw: string): Promise<string> {
  const parsed = AgentPackageSchema.parse(JSON.parse(raw));
  const kind = parsed.agent.kind;
  const draft: LearningAgentDraft = {
    name: parsed.agent.name,
    description: parsed.agent.description,
    prompt: parsed.files["prompt.md"],
    kind,
    hook: parsed.agent.hook ?? hookForKind(kind),
    dataScopes: parsed.agent.dataScopes,
    allowedTools: parsed.agent.allowedTools,
    writebackPolicy: parsed.agent.writebackPolicy,
    outputSchema: parsed.files["schema.json"] ?? null,
    enabled: true,
  };
  return createLearningAgent(draft);
}
