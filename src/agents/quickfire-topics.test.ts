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

// rng ≈ 1 makes the Fisher–Yates shuffle a no-op (identity), so these assertions can check exact order/content.
const ctx = {
  targetLanguage: "English",
  nativeLanguage: "Chinese",
  level: "intermediate",
  rng: () => 0.999999,
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

  it("salvages a malformed markdown-ish one-line topic", async () => {
    const provider = stubProvider(
      () =>
        "Awkward corner case):* Disputing an incorrect charge on a utility”",
    );
    expect(await generateQuickfireTopics(provider, ctx)).toEqual([
      "Disputing an incorrect charge on a utility",
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
    expect(topics).toHaveLength(8);
    expect(topics[0]).toBe("场景0");
  });

  it("over-generates then samples down to the display count", async () => {
    const many = Array.from({ length: 16 }, (_, i) => `选项${i}`);
    const provider = stubProvider(() => JSON.stringify({ topics: many }));
    // A non-identity rng so the shuffle actually reorders; result is still a deduped subset of the input.
    let seed = 0;
    const rng = () => {
      seed = (seed + 0.37) % 1;
      return seed;
    };
    const topics = await generateQuickfireTopics(provider, { ...ctx, rng });
    expect(topics).toHaveLength(8);
    expect(new Set(topics).size).toBe(8);
    for (const t of topics) expect(many).toContain(t);
  });

  it("falls back to default topics when nothing parseable comes back", async () => {
    const provider = stubProvider(() => "Sorry, I cannot help with that.");
    expect(await generateQuickfireTopics(provider, ctx)).toEqual([
      "处理快递送错地址",
      "向店员反馈多收费问题",
      "预约看医生",
      "和同事委婉改时间",
      "机场值机遇到问题",
      "退换有瑕疵商品",
      "房东拖延维修",
      "第一次见面闲聊",
    ]);
  });
});
