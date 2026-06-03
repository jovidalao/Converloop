import { describe, expect, it } from "vitest";
import {
  dispatchObservers,
  dispatchReply,
  getActions,
  getObservers,
  getReplyProducer,
  registerAction,
  registerObserver,
  registerReplyProducer,
  runAction,
} from "./registry";
import type {
  ActionAgent,
  Observer,
  PracticeContext,
  ReplyProducer,
} from "./types";

// 本测试只验证注册表/派发机制,故直接 import ./registry(不经 ./index,内置 Agent 不会自注册)。
// 运行日志写入走 DB,在 vitest 里会被 fire-and-forget 的 .catch 吞掉,不影响断言。
function fakePracticeCtx(turnId = "t1"): PracticeContext {
  // 测试桩:派发只读 turnId / turnPersisted,其余字段不构造。
  return {
    kind: "practice",
    turnId,
    turnPersisted: Promise.resolve(turnId),
  } as unknown as PracticeContext;
}

describe("agent runtime registry", () => {
  it("新注册的 observer 进入 getObservers 并被 dispatchObservers 调用(无需改 runTurn)", async () => {
    let seenTurnId: string | null = null;
    let resolveRan!: () => void;
    const ran = new Promise<void>((r) => {
      resolveRan = r;
    });
    const observer: Observer = {
      id: "test:observer",
      kind: "observer",
      run: async (ctx) => {
        seenTurnId = ctx.turnId;
        resolveRan();
      },
    };
    registerObserver(observer);
    expect(getObservers().some((o) => o.id === "test:observer")).toBe(true);

    dispatchObservers(fakePracticeCtx("turn-x"));
    await ran;
    expect(seenTurnId).toBe("turn-x");
  });

  it("dispatchReply 按 kind 取对应 reply producer 并回传其结果与流式增量", async () => {
    const deltas: string[] = [];
    const producer: ReplyProducer = {
      id: "test:reply",
      kind: "reply_producer",
      conversationKind: "practice",
      run: async (_ctx, onDelta) => {
        onDelta("hel");
        onDelta("lo");
        return "hello";
      },
    };
    registerReplyProducer(producer);
    expect(getReplyProducer("practice")?.id).toBe("test:reply");

    const reply = await dispatchReply(fakePracticeCtx(), (d) => deltas.push(d));
    expect(reply).toBe("hello");
    expect(deltas.join("")).toBe("hello");
  });

  it("新注册的 action 按 scope 可取,runAction 调用它并回传结果(无需改 ChatView)", async () => {
    let ranWith: string | null = null;
    const action: ActionAgent = {
      id: "test:action",
      kind: "action",
      scope: "session",
      label: "测试动作",
      run: async (ctx) => {
        ranWith = ctx.conversationId;
        return { navigateTo: "new-conv-id" };
      },
    };
    registerAction(action);
    expect(getActions("session").some((a) => a.id === "test:action")).toBe(
      true,
    );
    expect(getActions("turn").some((a) => a.id === "test:action")).toBe(false);

    const result = await runAction("test:action", { conversationId: "c1" });
    expect(ranWith).toBe("c1");
    expect(result.navigateTo).toBe("new-conv-id");
  });
});
