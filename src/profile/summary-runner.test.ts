import { describe, expect, it } from "vitest";
import type { Turn } from "../db/schema";
import { pickFoldTurns } from "./summary-runner";

function mkTurn(i: number, replyLen = 400): Turn {
  return {
    id: `t${i}`,
    createdAt: i,
    userInput: "",
    reply: "x".repeat(replyLen),
    analysisJson: null,
    conversationId: "c1",
    explainCount: 0,
    bilingualCount: 0,
  };
}

describe("pickFoldTurns", () => {
  const turns = Array.from({ length: 10 }, (_, i) => mkTurn(i));

  it("预算极小:也至少保留 6 轮(MIN_VERBATIM),只折叠更老的", () => {
    const fold = pickFoldTurns(turns, 1);
    expect(fold.length).toBe(10 - 6); // 折叠最老的 4 轮
    expect(fold.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("预算极大:无需折叠", () => {
    expect(pickFoldTurns(turns, 1_000_000)).toHaveLength(0);
  });

  it("不足 6 轮:不折叠(整段都在保留窗口内)", () => {
    expect(pickFoldTurns(turns.slice(0, 5), 1)).toHaveLength(0);
  });

  it("折叠的总是最老的、保留的总是最新的(连续切分)", () => {
    const fold = pickFoldTurns(turns, 1);
    const foldIds = new Set(fold.map((t) => t.id));
    // 保留集 = 最新若干轮,折叠集 = 其余最老轮,二者不重叠且拼回原序。
    const keptIds = turns.filter((t) => !foldIds.has(t.id)).map((t) => t.id);
    expect(keptIds).toEqual(["t4", "t5", "t6", "t7", "t8", "t9"]);
  });
});
