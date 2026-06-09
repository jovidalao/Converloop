import { describe, expect, it } from "vitest";
import { runAbortableStream } from "./abortable-stream";

describe("runAbortableStream", () => {
  it("forwards every delta and resolves with the full text when not aborted", async () => {
    const got: string[] = [];
    const reply = await runAbortableStream(
      (onDelta) => {
        onDelta("a");
        onDelta("b");
        onDelta("c");
        return Promise.resolve("abc");
      },
      (d) => got.push(d),
      undefined,
    );
    expect(reply).toBe("abc");
    expect(got).toEqual(["a", "b", "c"]);
  });

  it("returns the partial so far when aborted synchronously during the run", async () => {
    const got: string[] = [];
    const controller = new AbortController();
    const reply = await runAbortableStream(
      (onDelta) => {
        onDelta("hel");
        onDelta("lo");
        controller.abort(); // abort before the run's promise is even returned
        onDelta(" world"); // dropped: signal already aborted
        return Promise.resolve("hello world");
      },
      (d) => got.push(d),
      controller.signal,
    );
    expect(reply).toBe("hello");
    expect(got).toEqual(["hel", "lo"]);
  });

  it("returns the partial when abort fires asynchronously, dropping later deltas", async () => {
    const got: string[] = [];
    const controller = new AbortController();
    let finishLate!: () => void;
    const promise = runAbortableStream(
      (onDelta) =>
        new Promise<string>((resolve) => {
          onDelta("part");
          finishLate = () => {
            onDelta("ial"); // arrives after abort → dropped
            resolve("partial");
          };
        }),
      (d) => got.push(d),
      controller.signal,
    );
    await Promise.resolve(); // let the run return its pending promise + attach the listener
    controller.abort();
    const reply = await promise;
    finishLate(); // late settle of the underlying stream must be harmless
    await Promise.resolve();
    expect(reply).toBe("part");
    expect(got).toEqual(["part"]);
  });

  it("does not throw when the underlying stream rejects after an abort", async () => {
    const controller = new AbortController();
    let rejectLate!: (e: unknown) => void;
    const promise = runAbortableStream(
      () =>
        new Promise<string>((_, reject) => {
          rejectLate = reject;
        }),
      () => {},
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(promise).resolves.toBe("");
    // A rejection after the abort-driven resolve is swallowed (no unhandled rejection).
    expect(() => rejectLate(new Error("late"))).not.toThrow();
    await Promise.resolve();
  });

  it("propagates a rejection that happens before any abort", async () => {
    const controller = new AbortController();
    await expect(
      runAbortableStream(
        () => Promise.reject(new Error("boom")),
        () => {},
        controller.signal,
      ),
    ).rejects.toThrow("boom");
  });
});
