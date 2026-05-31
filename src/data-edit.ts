import { planDataEdit } from "./agents/data-editor";
import type { AppConfig } from "./config";
import {
  createManualMasteryItem,
  deleteMasteryItem,
  getAllMastery,
  markMasteryKnown,
  setMasteryStatus,
  updateMasteryItem,
} from "./db/mastery";
import type { MasteryStatus, MasteryType } from "./db/mastery-logic";
import type { ModelProvider } from "./providers/types";

export interface DataEditResult {
  summary: string;
  applied: number;
  skipped: string[];
}

export async function applyDataEditInstruction(
  provider: ModelProvider,
  instruction: string,
  config: AppConfig,
): Promise<DataEditResult> {
  const items = await getAllMastery();
  const existingKeys = new Set(items.map((item) => item.key));
  const plan = await planDataEdit(provider, instruction, items, {
    nativeLanguage: config.nativeLanguage,
  });

  let applied = 0;
  const skipped: string[] = [];

  for (const op of plan.operations) {
    if (op.action === "delete") {
      if (!existingKeys.has(op.key)) {
        skipped.push(`找不到 ${op.key}`);
        continue;
      }
      await deleteMasteryItem(op.key);
      applied++;
      continue;
    }

    if (op.action === "create") {
      if (!op.label || !op.type) {
        skipped.push(`创建 ${op.key} 缺少 label 或 type`);
        continue;
      }
      await createManualMasteryItem({
        key: op.key,
        label: op.label,
        type: op.type as MasteryType,
        status: (op.status ?? "learning") as MasteryStatus,
        example: op.example,
        notes: op.notes,
      });
      applied++;
      continue;
    }

    if (!existingKeys.has(op.key)) {
      skipped.push(`找不到 ${op.key}`);
      continue;
    }
    await updateMasteryItem(op.key, {
      label: op.label,
      example: op.example,
      notes: op.notes,
    });
    if (op.status) {
      if (op.status === "known") await markMasteryKnown(op.key);
      else await setMasteryStatus(op.key, op.status as MasteryStatus);
    }
    applied++;
  }

  return { summary: plan.summary, applied, skipped };
}
