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
        title: "面试英语准备",
        goal: "为前端岗位英语面试准备自我介绍和项目讲解。",
        plan_markdown: "## Week 1\n练自我介绍和项目说明。",
        notes_markdown: "先从最常见的问题开始。",
        suggested_lessons: [
          {
            name: "项目讲解",
            description: "练习讲清楚前端项目经历。",
            prompt:
              "Run an interview-style lesson. Ask the learner to explain one frontend project, give concise feedback, then ask a follow-up that forces clearer technical wording.",
            data_scopes: ["profile", "weak_all", "proficiency"],
          },
        ],
        next_actions: ["开始项目讲解专项课"],
      });
    });

    const plan = await planLearningProject(provider, "准备英语前端面试", {
      nativeLanguage: "Chinese",
      targetLanguage: "English",
      level: "B1",
    });

    expect(calls[0].jsonSchema?.name).toBe("GeneratedLearningProject");
    expect(calls[0].meta?.label).toBe("task_agent");
    expect(plan.title).toBe("面试英语准备");
    expect(plan.suggestedLessons[0]).toMatchObject({
      name: "项目讲解",
      dataScopes: ["profile", "weak_all", "proficiency"],
      allowedTools: ["read_learning_data"],
      writebackPolicy: "none",
    });
  });
});
