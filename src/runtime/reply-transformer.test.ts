import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateOptions } from "../providers/types";

// Hoisted so the vi.mock factories below can reference them safely (vi.mock is hoisted above imports).
const h = vi.hoisted(() => ({
  createTurnAnnotation: vi.fn(),
  createMemoryProposal: vi.fn(),
  gen: { impl: (_opts: unknown) => "" as string },
}));

vi.mock("../config", () => ({
  getProvider: async () => ({
    generate: async (opts: GenerateOptions) => h.gen.impl(opts),
    stream: async () => {
      throw new Error("not used");
    },
  }),
  loadConfig: () => ({
    nativeLanguage: "Chinese",
    targetLanguage: "English",
    level: "B1",
  }),
}));
vi.mock("../learning-data", () => ({
  buildLearningDataContext: async () => "",
}));
vi.mock("../db/turn-annotations", () => ({
  createTurnAnnotation: h.createTurnAnnotation,
}));
vi.mock("../db/memory-proposals", () => ({
  createMemoryProposal: h.createMemoryProposal,
}));

import type {
  LearningAgentMeta,
  LearningAgentOutputMode,
  TransformerStage,
} from "../db/learning-agents";
import { replyTransformerFromAgent } from "./custom-agents";

function agent(
  outputMode: LearningAgentOutputMode,
  transformerStage: TransformerStage = "ai_reply",
): LearningAgentMeta {
  return {
    id: "a1",
    name: "Simplify",
    description: "",
    prompt: "Simplify the reply.",
    dataScopes: [],
    kind: "reply_transformer",
    icon: "star",
    autoRun: 0,
    outputMode,
    transformerStage,
  } as unknown as LearningAgentMeta;
}

const input = { turnId: "t1", text: "It is quite cumbersome." };

describe("custom reply transformer runner routes by output mode", () => {
  beforeEach(() => {
    h.createTurnAnnotation.mockReset().mockResolvedValue("ann1");
    h.createMemoryProposal.mockReset().mockResolvedValue("mp1");
  });

  it("panel returns Markdown and persists nothing", async () => {
    h.gen.impl = () => "**simpler**";
    const r = await replyTransformerFromAgent(agent("panel")).run(input);
    expect(r.markdown).toBe("**simpler**");
    expect(h.createTurnAnnotation).not.toHaveBeenCalled();
    expect(h.createMemoryProposal).not.toHaveBeenCalled();
  });

  it("replace returns Markdown (same path as panel)", async () => {
    h.gen.impl = () => "easy version";
    const r = await replyTransformerFromAgent(agent("replace")).run(input);
    expect(r.markdown).toBe("easy version");
  });

  it("coach writes a turn annotation and returns no Markdown", async () => {
    h.gen.impl = () => "a coach note";
    const r = await replyTransformerFromAgent(agent("coach")).run(input);
    expect(r.markdown).toBeUndefined();
    expect(h.createTurnAnnotation).toHaveBeenCalledTimes(1);
    expect(h.createTurnAnnotation.mock.calls[0][0]).toMatchObject({
      turnId: "t1",
      agentId: "custom:a1",
      title: "Simplify",
      bodyMd: "a coach note",
    });
    expect(h.createMemoryProposal).not.toHaveBeenCalled();
  });

  it("memory proposes a learning-memory write and returns no Markdown", async () => {
    h.gen.impl = () =>
      JSON.stringify({ title: "T", body_md: "n", memory_proposals: [] });
    const r = await replyTransformerFromAgent(agent("memory")).run(input);
    expect(r.markdown).toBeUndefined();
    expect(h.createMemoryProposal).toHaveBeenCalledTimes(1);
    expect(h.createMemoryProposal.mock.calls[0][0]).toMatchObject({
      agentId: "custom:a1",
      turnId: "t1",
    });
    expect(h.createTurnAnnotation).not.toHaveBeenCalled();
  });

  it("user_message stage runs on the learner's message with learner wording", async () => {
    let captured: GenerateOptions | null = null;
    h.gen.impl = (opts) => {
      captured = opts as GenerateOptions;
      return "more natural version";
    };
    const userInput = { turnId: "t2", text: "I very like this." };
    const r = await replyTransformerFromAgent(
      agent("panel", "user_message"),
    ).run(userInput);
    expect(r.markdown).toBe("more natural version");
    const opts = captured as unknown as GenerateOptions;
    const system = String(opts.messages[0]?.content);
    const user = String(opts.messages[1]?.content);
    expect(system).toContain("learner's own message");
    expect(user).toContain("THE LEARNER'S MESSAGE");
    expect(user).toContain("I very like this.");
  });
});
