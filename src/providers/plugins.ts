import { logDebug, logError } from "../lib/log";
import type { GenerateOptions, ModelProvider } from "./types";

// 极简插件管线:在 ModelProvider 外包一层,把横切关注点(日志、参数改写)从
// agent / orchestrator 里抽出来,而不改动 provider 自身(HTTP 仍走 Rust)。
// 钩子借鉴 Cherry Studio aiCore 的形状,但只取当前真正用得到的三个。
export interface PluginContext {
  /** 流式还是一次性生成。 */
  stream: boolean;
  /** 调用方标签(如 "conversation" / "tutor"),来自 opts.meta.label。 */
  label: string;
  /** 调用开始时间戳(ms),用于算时延。 */
  startTime: number;
}

export interface ProviderPlugin {
  name: string;
  /** 链式改写请求参数(按数组顺序依次套用)。 */
  transformParams?(
    opts: GenerateOptions,
    ctx: PluginContext,
  ): GenerateOptions | Promise<GenerateOptions>;
  /** 成功拿到完整输出后(流式为拼好的全文)。 */
  onResult?(output: string, ctx: PluginContext): void;
  /** 调用抛错时;插件不吞错,异常照常向上抛。 */
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

/** 用插件管线包裹一个 provider;无插件时等价于原 provider。 */
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

// 时延 / 结果长度走 debug 开关(见 lib/log);错误始终打印(集中替代散落的 console.error)。
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

/** getProvider 默认挂上的插件集。新增横切能力时往这里加。 */
export function defaultPlugins(): ProviderPlugin[] {
  return [loggingPlugin];
}
