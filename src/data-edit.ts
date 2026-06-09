import type { DataEditOperation } from "./agents/data-editor";
import { planDataEdit } from "./agents/data-editor";
import type { AppConfig } from "./config";
import {
  createManualMasteryItem,
  deleteMasteryItem,
  getAllMastery,
  markMasteryKnown,
  mergeMasteryItems,
  setMasteryStatus,
  updateMasteryItem,
} from "./db/mastery";
import type { MasteryStatus, MasteryType } from "./db/mastery-logic";
import {
  MASTERY_STATUS_VALUES,
  MASTERY_TYPE_VALUES,
} from "./db/mastery-values";
import type { ModelProvider } from "./providers/types";

export interface DataEditResult {
  summary: string;
  applied: number;
  skipped: string[];
}

export interface DataEditPreview {
  summary: string;
  operations: DataEditOperation[];
}

function validType(type: string | undefined): type is MasteryType {
  return MASTERY_TYPE_VALUES.includes(type as MasteryType);
}

function validStatus(status: string | undefined): status is MasteryStatus {
  return MASTERY_STATUS_VALUES.includes(status as MasteryStatus);
}

export async function applyDataEditOperations(
  operations: DataEditOperation[],
  summary: string,
): Promise<DataEditResult> {
  const items = await getAllMastery();
  const existingKeys = new Set(items.map((item) => item.key));
  let applied = 0;
  const skipped: string[] = [];

  for (const op of operations) {
    if (op.action === "merge") {
      if (!op.target_key) {
        skipped.push(`merge ${op.key}: missing target_key`);
        continue;
      }
      if (!existingKeys.has(op.key)) {
        skipped.push(`${op.key}: not found`);
        continue;
      }
      if (!existingKeys.has(op.target_key)) {
        skipped.push(`${op.target_key}: not found`);
        continue;
      }
      await mergeMasteryItems(op.key, op.target_key);
      applied++;
      existingKeys.delete(op.key);
      continue;
    }

    if (op.action === "delete") {
      if (!existingKeys.has(op.key)) {
        skipped.push(`${op.key}: not found`);
        continue;
      }
      await deleteMasteryItem(op.key);
      applied++;
      existingKeys.delete(op.key);
      continue;
    }

    if (op.action === "create") {
      if (!op.label || !validType(op.type)) {
        skipped.push(`create ${op.key}: missing label or type`);
        continue;
      }
      await createManualMasteryItem({
        key: op.key,
        label: op.label,
        type: op.type,
        status: validStatus(op.status) ? op.status : "learning",
        example: op.example,
        notes: op.notes,
      });
      applied++;
      existingKeys.add(op.key);
      continue;
    }

    if (!existingKeys.has(op.key)) {
      skipped.push(`${op.key}: not found`);
      continue;
    }
    if (op.status && !validStatus(op.status)) {
      skipped.push(`${op.key}: invalid status ${op.status}`);
      continue;
    }
    await updateMasteryItem(op.key, {
      label: op.label,
      example: op.example,
      notes: op.notes,
    });
    if (op.status) {
      if (op.status === "known") await markMasteryKnown(op.key);
      else await setMasteryStatus(op.key, op.status);
    }
    applied++;
  }

  return { summary, applied, skipped };
}

export async function applyDataEditInstruction(
  provider: ModelProvider,
  instruction: string,
  config: AppConfig,
): Promise<DataEditResult> {
  const plan = await planDataEditInstruction(provider, instruction, config);
  return applyDataEditOperations(plan.operations, plan.summary);
}

export async function planDataEditInstruction(
  provider: ModelProvider,
  instruction: string,
  config: AppConfig,
): Promise<DataEditPreview> {
  const items = await getAllMastery();
  const plan = await planDataEdit(provider, instruction, items, {
    nativeLanguage: config.nativeLanguage,
  });
  return { summary: plan.summary, operations: plan.operations };
}
