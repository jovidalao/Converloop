// 内置 Agent 的用户改写(通用,Phase 4+)。用户可以改内置能力的展示名/说明,并【追加】
// 补充指令(不替换官方基础 prompt)。改写存 localStorage(与 enablement 一致,属前端偏好,
// 不进 SQLite),空字段表示沿用默认。运行时在能力库目录与各能力调用点实时合并;
// 改写不动计数 / 密钥 / provider 设置。

const KEY = "builtinAgentOverrides";

export interface BuiltinAgentOverride {
  label?: string;
  description?: string;
  /** 追加在官方基础 prompt 之后的补充指令(不替换基础 prompt)。 */
  instructions?: string;
}

let cache: Record<string, BuiltinAgentOverride> | null = null;

function all(): Record<string, BuiltinAgentOverride> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    cache =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, BuiltinAgentOverride>)
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(map: Record<string, BuiltinAgentOverride>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 测试环境无 localStorage:仅内存缓存生效
  }
}

export function getBuiltinAgentOverride(
  id: string,
): BuiltinAgentOverride | undefined {
  return all()[id];
}

export function setBuiltinAgentOverride(
  id: string,
  patch: BuiltinAgentOverride,
): void {
  const map = all();
  const clean: BuiltinAgentOverride = {};
  if (patch.label?.trim()) clean.label = patch.label.trim();
  if (patch.description?.trim()) clean.description = patch.description.trim();
  if (patch.instructions?.trim())
    clean.instructions = patch.instructions.trim();
  if (Object.keys(clean).length === 0) delete map[id];
  else map[id] = clean;
  persist(map);
}

export function clearBuiltinAgentOverride(id: string): void {
  const map = all();
  delete map[id];
  persist(map);
}
