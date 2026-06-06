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
    excludeFromContext: 0,
  };
}

describe("pickFoldTurns", () => {
  const turns = Array.from({ length: 10 }, (_, i) => mkTurn(i));

  it("very small budget: still keeps at least 6 turns (MIN_VERBATIM), folds only older ones", () => {
    const fold = pickFoldTurns(turns, 1);
    expect(fold.length).toBe(10 - 6); // fold the oldest 4 turns
    expect(fold.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("very large budget: no folding needed", () => {
    expect(pickFoldTurns(turns, 1_000_000)).toHaveLength(0);
  });

  it("fewer than 6 turns: no folding (entire window is within the keep range)", () => {
    expect(pickFoldTurns(turns.slice(0, 5), 1)).toHaveLength(0);
  });

  it("folded turns are always the oldest, kept turns always the newest (contiguous split)", () => {
    const fold = pickFoldTurns(turns, 1);
    const foldIds = new Set(fold.map((t) => t.id));
    // Keep set = most recent N turns, fold set = all remaining older turns; the two are disjoint and concatenate back to the original order.
    const keptIds = turns.filter((t) => !foldIds.has(t.id)).map((t) => t.id);
    expect(keptIds).toEqual(["t4", "t5", "t6", "t7", "t8", "t9"]);
  });
});
