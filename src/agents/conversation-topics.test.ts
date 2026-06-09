import { describe, expect, it } from "vitest";
import type { GenerateOptions, ModelProvider } from "../providers/types";
import { generateConversationTopics } from "./conversation-topics";

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

describe("generateConversationTopics", () => {
  it("requests structured output and returns the topic list", async () => {
    const calls: GenerateOptions[] = [];
    const provider = stubProvider((opts) => {
      calls.push(opts);
      return JSON.stringify({ topics: ["聊聊周末", "最近的剧", "理想旅行"] });
    });
    const topics = await generateConversationTopics(provider, ctx);
    expect(topics).toEqual(["聊聊周末", "最近的剧", "理想旅行"]);
    expect(calls[0].jsonSchema?.name).toBe("ConversationTopics");
  });

  it("salvages a bare JSON array when the endpoint ignores json_schema", async () => {
    const provider = stubProvider(() => '["喜欢的美食", "工作趣事"]');
    expect(await generateConversationTopics(provider, ctx)).toEqual([
      "喜欢的美食",
      "工作趣事",
    ]);
  });

  it("over-generates then samples down to the display count", async () => {
    const many = Array.from({ length: 16 }, (_, i) => `话题${i}`);
    const provider = stubProvider(() => JSON.stringify({ topics: many }));
    let seed = 0;
    const rng = () => {
      seed = (seed + 0.37) % 1;
      return seed;
    };
    const topics = await generateConversationTopics(provider, { ...ctx, rng });
    expect(topics).toHaveLength(8);
    expect(new Set(topics).size).toBe(8);
    for (const t of topics) expect(many).toContain(t);
  });

  it("falls back to default topics when nothing parseable comes back", async () => {
    const provider = stubProvider(() => "Sorry, I cannot help with that.");
    expect(await generateConversationTopics(provider, ctx)).toEqual([
      "聊聊最近看的电影或剧",
      "周末是怎么过的",
      "理想的旅行目的地",
      "最近在忙的项目",
      "最爱的一道家乡菜",
      "工作里遇到的趣事",
      "想养成的新习惯",
      "小时候难忘的回忆",
    ]);
  });
});
