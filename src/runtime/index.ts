// Agent Runtime entry point. Importing this module triggers built-in agent self-registration (side-effect import),
// so consumers (orchestrator) only need `import { ... } from "./runtime"` to get the populated registry.
import "./builtins";

export * from "./builtin-overrides";
export { BUILTIN_ACTION_DEFAULTS, type BuiltinActionDefault } from "./builtins";
export * from "./custom-agents";
export * from "./enablement";
export * from "./registry";
export * from "./types";
export * from "./visibility";
