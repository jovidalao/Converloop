// Cooperative "stop generating": run a streaming text producer, but if `signal`
// aborts, resolve immediately with whatever has streamed so far. The underlying
// producer keeps running — its later deltas are dropped and its eventual settle
// is swallowed — so this stops the wait, not the work (e.g. a streamed LLM reply
// whose request lives in the Rust layer and can't be cancelled mid-flight). The
// partial text is returned so the caller can persist it like a complete reply.
// With no signal, behaves exactly like the wrapped call.
export async function runAbortableStream(
  run: (onDelta: (delta: string) => void) => Promise<string>,
  onDelta: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  let acc = "";
  const collect = (delta: string) => {
    if (signal?.aborted) return; // freeze the partial at abort time; ignore late deltas
    acc += delta;
    onDelta?.(delta);
  };
  const streamPromise = run(collect);
  if (!signal) return streamPromise;
  if (signal.aborted) {
    void streamPromise.catch(() => {}); // request runs on in the background; don't leak a rejection
    return acc;
  }
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      resolve(acc);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    streamPromise.then(
      (full) => {
        signal.removeEventListener("abort", onAbort);
        if (!settled) {
          settled = true;
          resolve(full);
        }
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        // A rejection arriving after an abort-driven resolve is intentionally
        // dropped (the handler keeps it from becoming an unhandled rejection).
        if (!settled) {
          settled = true;
          reject(err);
        }
      },
    );
  });
}
