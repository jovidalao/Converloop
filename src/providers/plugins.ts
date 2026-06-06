import { logDebug, logError } from "../lib/log";
import type { GenerateOptions, ModelProvider } from "./types";

// Minimal plugin pipeline: wraps a ModelProvider to extract cross-cutting concerns (logging, param rewriting)
// from the agent / orchestrator without modifying the provider itself (HTTP still uses Rust).
// Hook shape inspired by Cherry Studio aiCore, but only the three currently needed.
export interface PluginContext {
  /** Whether this is streaming or one-shot generation. */
  stream: boolean;
  /** Caller label (e.g. "conversation" / "tutor"), from opts.meta.label. */
  label: string;
  /** Call start timestamp (ms), used to compute latency. */
  startTime: number;
}

export interface ProviderPlugin {
  name: string;
  /** Chain-transform request params (applied in array order). */
  transformParams?(
    opts: GenerateOptions,
    ctx: PluginContext,
  ): GenerateOptions | Promise<GenerateOptions>;
  /** Called after successfully receiving the complete output (full assembled text for streaming). */
  onResult?(output: string, ctx: PluginContext): void;
  /** Called when the call throws; plugins do not swallow errors, exceptions propagate as normal. */
  onError?(error: unknown, ctx: PluginContext): void;
}

async function runPipeline(
  opts: GenerateOptions,
  plugins: ProviderPlugin[],
  stream: boolean,
  call: (opts: GenerateOptions) => Promise<string>,
): Promise<string> {
  const ctx: PluginContext = {
    stream,
    label: opts.meta?.label ?? "llm",
    startTime: Date.now(),
  };

  let params = opts;
  for (const p of plugins) {
    if (p.transformParams) params = await p.transformParams(params, ctx);
  }

  try {
    const output = await call(params);
    for (const p of plugins) p.onResult?.(output, ctx);
    return output;
  } catch (e) {
    for (const p of plugins) p.onError?.(e, ctx);
    throw e;
  }
}

/** Wrap a provider with the plugin pipeline; equivalent to the original provider when there are no plugins. */
export function withPlugins(
  provider: ModelProvider,
  plugins: ProviderPlugin[],
): ModelProvider {
  if (plugins.length === 0) return provider;
  return {
    generate: (opts) =>
      runPipeline(opts, plugins, false, (o) => provider.generate(o)),
    stream: (opts, onDelta) =>
      runPipeline(opts, plugins, true, (o) => provider.stream(o, onDelta)),
  };
}

// Latency / output length go through the debug toggle (see lib/log); errors are always logged (centralized replacement for scattered console.error calls).
export const loggingPlugin: ProviderPlugin = {
  name: "logging",
  onResult(output, ctx) {
    const ms = Date.now() - ctx.startTime;
    logDebug(
      `llm:${ctx.label}`,
      `${ctx.stream ? "stream" : "generate"} ok ${ms}ms, ${output.length} chars`,
    );
  },
  onError(error, ctx) {
    const ms = Date.now() - ctx.startTime;
    const msg = error instanceof Error ? error.message : String(error);
    logError(`llm:${ctx.label}`, `failed after ${ms}ms: ${msg}`);
  },
};

/** Default plugin set attached by getProvider. Add new cross-cutting capabilities here. */
export function defaultPlugins(): ProviderPlugin[] {
  return [loggingPlugin];
}
