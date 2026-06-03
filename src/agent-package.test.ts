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
      writes: "可提出学习数据写入建议(需确认)",
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
});
