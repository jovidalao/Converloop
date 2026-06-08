import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { generateQuickfireTopics } from "./quickfire-topics";

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

const ctx = {
  targetLanguage: "English",
  nativeLanguage: "Chinese",
  level: "intermediate",
};

describe("generateQuickfireTopics", () => {
  it("requests structured output and returns the topic list", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return JSON.stringify({ topics: ["退货沟通", "机场值机", "同事闲聊"] });
    });
    const topics = await generateQuickfireTopics(provider, ctx);
    expect(topics).toEqual(["退货沟通", "机场值机", "同事闲聊"]);
    expect(calls[0].jsonSchema?.name).toBe("QuickfireTopics");
  });

  it("salvages a bare JSON array when the endpoint ignores json_schema", async () => {
    const provider = stubProvider(() => '["看病预约", "投诉账单"]');
    expect(await generateQuickfireTopics(provider, ctx)).toEqual([
      "看病预约",
      "投诉账单",
    ]);
  });

  it("salvages an object under an alternate field name", async () => {
    const provider = stubProvider(() =>
      JSON.stringify({ scenarios: ["点咖啡", "租房谈判"] }),
    );
    expect(await generateQuickfireTopics(provider, ctx)).toEqual([
      "点咖啡",
      "租房谈判",
    ]);
  });

  it("drops overly long labels and caps the count", async () => {
    const longLabel = "x".repeat(60);
    const many = Array.from({ length: 14 }, (_, i) => `场景${i}`);
    const provider = stubProvider(() =>
      JSON.stringify({ topics: [longLabel, ...many] }),
    );
    const topics = await generateQuickfireTopics(provider, ctx);
    expect(topics).not.toContain(longLabel);
    expect(topics).toHaveLength(10);
    expect(topics[0]).toBe("场景0");
  });

  it("returns an empty list when nothing parseable comes back", async () => {
    const provider = stubProvider(() => "Sorry, I cannot help with that.");
    expect(await generateQuickfireTopics(provider, ctx)).toEqual([]);
  });
});
