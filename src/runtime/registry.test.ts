import { describe, expect, it } from "vitest";
import {
  dispatchObservers,
  dispatchReply,
  getActions,
  getObservers,
  getReplyProducer,
  getTransformers,
  registerAction,
  registerObserver,
  registerReplyProducer,
  registerTransformer,
  runAction,
  runTransformer,
} from "./registry";
import type {
  ActionAgent,
  Observer,
  PracticeContext,
  ReplyProducer,
  TransformerInfo,
} from "./types";
import { HOOKS } from "./types";
import { hideAgent } from "./visibility";

// This test only verifies the registry/dispatch mechanism, so it imports ./registry directly (not ./index, so built-in agents do not self-register).
// Agent run log writes go to the DB and are swallowed by fire-and-forget .catch in vitest — they do not affect assertions.
function fakePracticeCtx(turnId = "t1"): PracticeContext {
  // Test stub: dispatch only reads turnId / turnPersisted; other fields are not constructed.
  return {
    kind: "practice",
    turnId,
    turnPersisted: Promise.resolve(turnId),
  } as unknown as PracticeContext;
}

describe("agent runtime registry", () => {
  it("newly registered observer appears in getObservers and is called by dispatchObservers (no changes to runTurn needed)", async () => {
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

  it("dispatchReply gets the matching reply producer by kind and returns result and streaming deltas", async () => {
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

  it("newly registered action is retrievable by scope, runAction calls it and returns result (no ChatView changes needed)", async () => {
    let ranWith: string | null = null;
    const action: ActionAgent = {
      id: "test:action",
      kind: "action",
      scope: "session",
      label: "test action",
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

  it("re-registering the same action id replaces instead of appending (HMR-safe: no duplicate branch buttons)", () => {
    const make = (label: string): ActionAgent => ({
      id: "test:idempotent-action",
      kind: "action",
      scope: "turn",
      label,
      run: async () => ({}),
    });
    registerAction(make("first"));
    registerAction(make("second"));
    const matches = getActions("turn").filter(
      (a) => a.id === "test:idempotent-action",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("second");
  });

  it("hidden action is filtered out from getActions and the capability list (delete = permanent hide)", () => {
    const action: ActionAgent = {
      id: "test:hidden-action",
      kind: "action",
      scope: "session",
      label: "action to be hidden",
      run: async () => ({}),
    };
    registerAction(action);
    expect(
      getActions("session").some((a) => a.id === "test:hidden-action"),
    ).toBe(true);

    hideAgent("test:hidden-action");
    expect(
      getActions("session").some((a) => a.id === "test:hidden-action"),
    ).toBe(false);
  });

  it("newly registered transformer appears in the capability list and runTransformer calls the on-demand task", async () => {
    const transformer: TransformerInfo = {
      id: "test:transformer",
      card: {
        title: "test transformer",
        description: "for testing",
        entry: "reply_action",
        timing: "on demand",
        reads: "test input",
        writes: "none",
        canDisable: false,
      },
    };
    registerTransformer(transformer);
    expect(getTransformers().some((t) => t.id === "test:transformer")).toBe(
      true,
    );

    const result = await runTransformer(
      "test:transformer",
      HOOKS.turnExplain,
      async () => "done",
      (text) => ({ chars: text.length }),
    );
    expect(result).toBe("done");
  });
});
