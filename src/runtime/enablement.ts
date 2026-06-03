// Agent 启用/禁用(Phase 4)。哪些 observer / action 被用户关掉,存 localStorage(与 config
// 等前端偏好一致,不进 SQLite)。运行时在派发处实时查询;能力库 UI 切换。
// 缓存一份在内存,避免热路径每轮反复读 localStorage + JSON.parse。

const KEY = "disabledAgents";
let cache: Set<string> | null = null;

function disabled(): Set<string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export function isAgentEnabled(id: string): boolean {
  return !disabled().has(id);
}

export function setAgentEnabled(id: string, enabled: boolean): void {
  const set = disabled();
  if (enabled) set.delete(id);
  else set.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // 测试环境无 localStorage:仅内存缓存生效
  }
}
