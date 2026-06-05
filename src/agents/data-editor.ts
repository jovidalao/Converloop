import { z } from "zod";
import type { MasteryItem } from "../db/schema";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { toJsonSchema } from "./json-schema";
import { formatZodError, parseLLMJson } from "./parse-llm-json";

// 学习数据「有限操作」的唯一 schema 真相源:data-edit / memory-proposal / 自定义
// observer 都从这里 import,新增掌握类型只改这一处(再同步 db/schema.ts 的 enum)。
export const DataEditOperation = z.object({
  action: z.enum(["update", "delete", "create", "merge"]),
  key: z.string().min(1),
  target_key: z.string().optional(),
  label: z.string().optional(),
  type: z
    .enum([
      "vocab",
      "grammar",
      "collocation",
      "error_pattern",
      "expression_gap",
    ])
    .optional(),
  status: z.enum(["struggling", "learning", "known"]).optional(),
  example: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const DataEditPlan = z.object({
  summary: z.string(),
  operations: z.array(DataEditOperation),
});

export type DataEditPlan = z.infer<typeof DataEditPlan>;
export type DataEditOperation = z.infer<typeof DataEditOperation>;

function oneLine(text: string | null, max = 140): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function formatItems(items: MasteryItem[]): string {
  if (items.length === 0) return "(none)";
  return items
    .slice(0, 120)
    .map(
      (item) =>
        `- ${item.key} | ${item.type} | ${item.status} | ${item.label} | example="${oneLine(
          item.example,
        )}" | notes="${oneLine(item.notes)}"`,
    )
    .join("\n");
}

function systemPrompt(ctx: { nativeLanguage: string }): string {
  return `You convert a user's natural-language request into safe edits for their language-learning data.

The data is a mastery table. You may propose ONLY these operations:
- update: edit label/example/notes/status for an existing key
- delete: delete one existing key from the active mastery table
- create: create one new mastery item with key, label, type, status, optional example/notes
- merge: merge a duplicate existing key into another existing key. Use key as
  the duplicate/source key and target_key as the canonical/target key.

Rules:
- Return JSON only.
- For update/delete, use an existing key exactly as listed.
- For merge, both key and target_key must be existing keys exactly as listed.
- Do not modify counts. Do not invent hidden fields.
- Prefer update over delete when the user asks to correct wording.
- Prefer merge when the user says two keys are duplicates or should be combined.
- If the request is ambiguous, return operations=[] and explain what is unclear in summary.
- Write summary in ${ctx.nativeLanguage}.`;
}

export async function planDataEdit(
  provider: ModelProvider,
  instruction: string,
  items: MasteryItem[],
  ctx: { nativeLanguage: string },
): Promise<DataEditPlan> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    {
      role: "user",
      content: `=== CURRENT MASTERY DATA ===
${formatItems(items)}

=== USER REQUEST ===
${instruction}`,
    },
  ];
  const raw = await provider.generate({
    messages,
    temperature: 0,
    maxTokens: 4096,
    jsonSchema: toJsonSchema("DataEditPlan", DataEditPlan),
    meta: { label: "data_editor" },
  });
  const parsed = parseLLMJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const validated = DataEditPlan.safeParse(parsed.value);
  if (!validated.success) {
    throw new Error(`数据修改计划校验失败: ${formatZodError(validated.error)}`);
  }
  return validated.data;
}
