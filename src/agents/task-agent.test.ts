import { describe, expect, it, vi } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { learningProjectJsonSchema, planLearningProject } from "./task-agent";

vi.mock("../db/learning-agents", () => {
  const values = [
    "profile",
    "weak_all",
    "weak_grammar",
    "expression_gaps",
    "today_turns",
    "due_review",
    "proficiency",
  ] as const;
  return {
    DATA_SCOPE_LABELS: Object.fromEntries(values.map((v) => [v, v])),
    LEARNING_DATA_SCOPE_VALUES: values,
  };
});

function stubProvider(
  generate: (opts: GenerateOptions) => string,
): ModelProvider {
  return {
    async generate(opts) {
      return generate(opts);
    },
    async stream() {
      throw new Error("not used");
    },
  };
}

describe("Task Agent", () => {
  it("exposes a clean JSON schema", () => {
    const { name, schema } = learningProjectJsonSchema();
    expect(name).toBe("GeneratedLearningProject");
    expect(schema.$schema).toBeUndefined();
    expect((schema as any).properties).toHaveProperty("suggested_lessons");
  });

  it("maps generated lessons into bounded learning agent drafts", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return JSON.stringify({
        title: "English interview prep",
        goal: "Prepare a self-introduction and project walkthrough for a frontend engineering interview.",
        plan_markdown: "## Week 1\nPractise self-introduction and project description.",
        notes_markdown: "Start with the most common interview questions.",
        suggested_lessons: [
          {
            name: "Project walkthrough",
            description: "Practise explaining a frontend project clearly.",
            prompt:
              "Run an interview-style lesson. Ask the learner to explain one frontend project, give concise feedback, then ask a follow-up that forces clearer technical wording.",
            data_scopes: ["profile", "weak_all", "proficiency"],
          },
        ],
        next_actions: ["Start the project walkthrough lesson"],
      });
    });

    const plan = await planLearningProject(provider, "Prepare for an English frontend engineering interview", {
      nativeLanguage: "Chinese",
      targetLanguage: "English",
      level: "B1",
    });

    expect(calls[0].jsonSchema?.name).toBe("GeneratedLearningProject");
    expect(calls[0].meta?.label).toBe("task_agent");
    expect(plan.title).toBe("English interview prep");
    expect(plan.suggestedLessons[0]).toMatchObject({
      name: "Project walkthrough",
      dataScopes: ["profile", "weak_all", "proficiency"],
      allowedTools: ["read_learning_data"],
      writebackPolicy: "none",
    });
  });
});
