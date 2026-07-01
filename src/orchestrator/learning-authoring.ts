import {
  type GeneratedDrillDocument,
  generateDrillDocument,
} from "../agents/drill-builder";
import { generateLearningAgentDraft } from "../agents/learning-agent-builder";
import { classifyProfilePreferenceInstruction } from "../agents/profile-preferences";
import {
  fallbackSelectionLearningItem,
  generateSelectionLearningItem,
} from "../agents/selection-learning-item";
import { planLearningProject } from "../agents/task-agent";
import { getProvider, loadConfig } from "../config";
import {
  applyDataEditInstruction,
  applyDataEditOperations,
  type DataEditPreview,
  type DataEditResult,
  planDataEditInstruction,
} from "../data-edit";
import { runTrackedAgentJob } from "../db/agent-jobs";
import { createLearningAgent } from "../db/learning-agents";
import {
  createLearningProject,
  setLearningProjectLessons,
} from "../db/learning-projects";
import { createManualMasteryItem, getMasteryKeyHints } from "../db/mastery";
import type { MasteryType } from "../db/mastery-logic";
import {
  appendClassifiedPreferences,
  preferencesFromProfile,
} from "../profile/preferences";
import { MissingApiKeyError } from "./shared";

export async function createCustomLearningAgentFromDescription(
  description: string,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const draft = await generateLearningAgentDraft(provider, description, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  });
  return createLearningAgent(draft);
}

// NL drill builder: description → drill@1 Markdown document (validated; one self-correction round).
// Returns the document + parse result for the create dialog to preview/save — it does NOT save.
export async function generateDrillDocumentFromDescription(
  description: string,
): Promise<GeneratedDrillDocument> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  const config = loadConfig();
  return generateDrillDocument(provider, description, {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  });
}

export async function createLearningProjectFromGoal(
  description: string,
): Promise<{
  projectId: string;
  createdLearningAgentIds: string[];
  jobId: string;
}> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();

  const config = loadConfig();
  const ctx = {
    nativeLanguage: config.nativeLanguage,
    targetLanguage: config.targetLanguage,
    level: config.level,
  };
  const { jobId, result } = await runTrackedAgentJob(
    {
      kind: "learning_project_plan",
      source: "task_agent",
      input: { description, ...ctx },
    },
    async () => {
      const plan = await planLearningProject(provider, description, ctx);
      const projectId = await createLearningProject({
        title: plan.title,
        goal: plan.goal,
        planMd: plan.planMarkdown,
        notesMd: plan.notesMarkdown,
        sourcePrompt: description,
        taskPlan: plan.raw,
      });
      const createdLearningAgentIds: string[] = [];
      for (const lesson of plan.suggestedLessons) {
        createdLearningAgentIds.push(await createLearningAgent(lesson));
      }
      // Link the generated lessons to the project so progress (done marks, next step) can be tracked.
      await setLearningProjectLessons(projectId, createdLearningAgentIds);
      return {
        projectId,
        createdLearningAgentIds,
        title: plan.title,
        goal: plan.goal,
        nextActions: plan.nextActions,
      };
    },
  );

  return {
    projectId: result.projectId,
    createdLearningAgentIds: result.createdLearningAgentIds,
    jobId,
  };
}

export async function editLearningDataWithInstruction(
  instruction: string,
): Promise<DataEditResult> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  return applyDataEditInstruction(provider, instruction, loadConfig());
}

export async function previewLearningDataEditWithInstruction(
  instruction: string,
): Promise<DataEditPreview> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  return planDataEditInstruction(provider, instruction, loadConfig());
}

export async function applyLearningDataEditPreview(
  preview: DataEditPreview,
): Promise<DataEditResult> {
  return applyDataEditOperations(preview.operations, preview.summary);
}

export async function applyProfilePreferenceInstruction(
  instruction: string,
  currentProfileMd: string,
): Promise<string> {
  const provider = await getProvider();
  if (!provider) throw new MissingApiKeyError();
  const items = await classifyProfilePreferenceInstruction(
    provider,
    instruction,
    preferencesFromProfile(currentProfileMd),
  );
  return appendClassifiedPreferences(currentProfileMd, items);
}

export async function addSelectionToLearningData(
  selection: string,
  context: string,
): Promise<{ key: string; label: string; type: string }> {
  const draft = await previewSelectionLearningItem(selection, context);
  await createSelectionLearningItem(draft);
  return { key: draft.key, label: draft.label, type: draft.type };
}

export interface SelectionLearningItemPreview {
  key: string;
  label: string;
  type: MasteryType;
  status?: "learning" | "struggling" | "known";
  example?: string | null;
  notes?: string | null;
}

export async function previewSelectionLearningItem(
  selection: string,
  context: string,
): Promise<SelectionLearningItemPreview> {
  const config = loadConfig();
  const provider = await getProvider();
  return provider
    ? await generateSelectionLearningItem(provider, {
        nativeLanguage: config.nativeLanguage,
        targetLanguage: config.targetLanguage,
        selection,
        context,
        existingKeys: (await getMasteryKeyHints(60)).map((h) => h.key),
      })
    : fallbackSelectionLearningItem(selection, context);
}

export async function createSelectionLearningItem(
  draft: SelectionLearningItemPreview,
): Promise<{ key: string; label: string; type: string }> {
  await createManualMasteryItem(draft);
  return { key: draft.key, label: draft.label, type: draft.type };
}
