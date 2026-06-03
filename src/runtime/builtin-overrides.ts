// 内置对话衍生 Agent 的用户改写(Phase 4+)。用户可以改内置动作的名称/说明/prompt;
// 改写存 localStorage(与 enablement 一致,属前端偏好,不进 SQLite),空字段表示沿用默认。
// 运行时在 deriveContext 与能力库目录处实时合并;改写不动计数 / 密钥 / provider 设置。

const KEY = "builtinActionOverrides";

export interface BuiltinActionOverride {
  label?: string;
  description?: string;
  objective?: string;
}

let cache: Record<string, BuiltinActionOverride> | null = null;

function all(): Record<string, BuiltinActionOverride> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    cache =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, BuiltinActionOverride>)
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(map: Record<string, BuiltinActionOverride>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 测试环境无 localStorage:仅内存缓存生效
  }
}

export function getBuiltinActionOverride(
  id: string,
): BuiltinActionOverride | undefined {
  return all()[id];
}

export function setBuiltinActionOverride(
  id: string,
  patch: BuiltinActionOverride,
): void {
  const map = all();
  const clean: BuiltinActionOverride = {};
  if (patch.label?.trim()) clean.label = patch.label.trim();
  if (patch.description?.trim()) clean.description = patch.description.trim();
  if (patch.objective?.trim()) clean.objective = patch.objective.trim();
  if (Object.keys(clean).length === 0) delete map[id];
  else map[id] = clean;
  persist(map);
}

export function clearBuiltinActionOverride(id: string): void {
  const map = all();
  delete map[id];
  persist(map);
}
