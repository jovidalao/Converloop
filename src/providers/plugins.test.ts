import { describe, expect, it, vi } from "vitest";
import { type ProviderPlugin, withPlugins } from "./plugins";
import type { GenerateOptions, ModelProvider } from "./types";

function stubProvider(
  onGenerate: (opts: GenerateOptions) => Promise<string> = async () => "ok",
): ModelProvider {
  return {
    generate: onGenerate,
    stream: async (opts, onDelta) => {
      onDelta("ok");
      return onGenerate(opts);
    },
  };
}

const opts = (): GenerateOptions => ({
  messages: [{ role: "user", content: "hi" }],
});

describe("withPlugins", () => {
  it("returns the original provider when there are no plugins", () => {
    const p = stubProvider();
    expect(withPlugins(p, [])).toBe(p);
  });

  it("chains transformParams in order before calling the provider", async () => {
    const seen: GenerateOptions[] = [];
    const provider = stubProvider(async (o) => {
      seen.push(o);
      return "done";
    });
    const a: ProviderPlugin = {
      name: "a",
      transformParams: (o) => ({ ...o, temperature: 0.1 }),
    };
    const b: ProviderPlugin = {
      name: "b",
      transformParams: (o) => ({ ...o, maxTokens: 99 }),
    };
    const wrapped = withPlugins(provider, [a, b]);
    await wrapped.generate(opts());
    expect(seen[0].temperature).toBe(0.1);
    expect(seen[0].maxTokens).toBe(99);
  });

  it("fires onResult with the output and onError on throw", async () => {
    const onResult = vi.fn();
    const onError = vi.fn();
    const plugin: ProviderPlugin = { name: "obs", onResult, onError };

    const okProvider = withPlugins(
      stubProvider(async () => "hello"),
      [plugin],
    );
    expect(await okProvider.generate(opts())).toBe("hello");
    expect(onResult).toHaveBeenCalledWith("hello", expect.anything());
    expect(onError).not.toHaveBeenCalled();

    const boom = new Error("nope");
    const badProvider = withPlugins(
      stubProvider(() => Promise.reject(boom)),
      [plugin],
    );
    await expect(badProvider.generate(opts())).rejects.toBe(boom);
    expect(onError).toHaveBeenCalledWith(boom, expect.anything());
  });

  it("exposes opts.meta.label to the plugin context", async () => {
    let label = "";
    const plugin: ProviderPlugin = {
      name: "label-spy",
      onResult: (_out, ctx) => {
        label = ctx.label;
      },
    };
    const wrapped = withPlugins(stubProvider(), [plugin]);
    await wrapped.generate({ ...opts(), meta: { label: "tutor" } });
    expect(label).toBe("tutor");
  });
});
