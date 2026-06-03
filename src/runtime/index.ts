// Agent Runtime 入口。import 本模块即触发内置 Agent 自注册(副作用 import),
// 因此消费方(orchestrator)只需 `import { ... } from "./runtime"` 就能拿到已注册的注册表。
import "./builtins";

export * from "./enablement";
export * from "./registry";
export * from "./types";
