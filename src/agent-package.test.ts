import { describe, expect, it } from "vitest";
import { reviewAgentPackage } from "./agent-package";

describe("agent package", () => {
  it("validates and summarizes package permissions", () => {
    const raw = JSON.stringify({
      format: "lang-agent.agent-package",
      version: 1,
      agent: {
        name: "Interview observer",
        description: "Finds vague interview answers.",
        kind: "observer",
        hook: "conversation.observe",
        dataScopes: ["profile", "weak_all"],
        allowedTools: ["read_learning_data"],
        writebackPolicy: "propose_review_signals",
      },
      files: {
        "prompt.md": "Watch for vague answers and suggest concrete rewrites.",
        "schema.json": null,
        "examples.json": [],
      },
    });

    expect(reviewAgentPackage(raw)).toMatchObject({
      name: "Interview observer",
      kind: "observer",
      writes: "Can propose learning data write-backs (requires confirmation)",
    });
  });

  it("rejects unknown package permissions", () => {
    const raw = JSON.stringify({
      format: "lang-agent.agent-package",
      version: 1,
      agent: {
        name: "Bad agent",
        description: "Invalid package",
        kind: "observer",
        hook: "conversation.observe",
        dataScopes: ["profile"],
        allowedTools: ["write_provider_key"],
        writebackPolicy: "none",
      },
      files: {
        "prompt.md": "Do something.",
        "examples.json": [],
      },
    });

    expect(() => reviewAgentPackage(raw)).toThrow();
  });

  it("rejects lesson packages in the runtime agent package importer", () => {
    const raw = JSON.stringify({
      format: "lang-agent.agent-package",
      version: 1,
      agent: {
        name: "Lesson package",
        description: "Not imported from the ability library.",
        kind: "lesson",
        hook: null,
        dataScopes: ["weak_all"],
        allowedTools: ["read_learning_data"],
        writebackPolicy: "none",
      },
      files: {
        "prompt.md": "Run a lesson.",
        "examples.json": [],
      },
    });

    expect(() => reviewAgentPackage(raw)).toThrow();
  });

  it("validates and summarizes store-ready packages", () => {
    const raw = JSON.stringify({
      format: "lang-agent.package",
      version: 1,
      package: {
        id: "com.example.interview-b1",
        version: "0.1.0",
        name: "B1 Interview Pack",
        description: "Practice interview answers and follow-up lessons.",
        tags: ["interview", "b1"],
      },
      items: [
        {
          type: "skill",
          id: "answer-observer",
          kind: "observer",
          hook: "conversation.observe",
          name: "Answer observer",
          description: "Finds vague answers.",
          prompt: "Watch for vague answers and suggest concrete rewrites.",
          dataScopes: ["profile", "weak_all"],
          allowedTools: ["read_learning_data"],
          writebackPolicy: "propose_review_signals",
        },
        {
          type: "lesson",
          id: "star-lesson",
          name: "STAR answer drill",
          description: "Practice STAR answers.",
          prompt: "Teach STAR interview answers through short drills.",
          dataScopes: ["profile", "weak_all"],
          allowedTools: ["read_learning_data"],
          writebackPolicy: "none",
        },
        {
          type: "course",
          id: "interview-course",
          title: "Interview course",
          goal: "Prepare for frontend interviews.",
          planMarkdown: "## Plan\nPractice answers, follow-ups, and questions.",
          lessons: [
            {
              id: "follow-up-lesson",
              name: "Follow-up questions",
              description: "Practice concise follow-ups.",
              prompt: "Run a follow-up question lesson.",
              dataScopes: ["profile"],
              allowedTools: ["read_learning_data"],
              writebackPolicy: "none",
            },
          ],
        },
      ],
    });

    expect(reviewAgentPackage(raw)).toMatchObject({
      name: "B1 Interview Pack",
      kind: "package",
      itemSummary: "1 skill(s) · 2 lesson(s) · 1 course item(s)",
      writes: "Can propose learning data write-backs (requires confirmation)",
    });
  });
});
