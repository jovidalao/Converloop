// 内置能力「删除」= 永久隐藏(无恢复)。哪些 Agent 被用户隐藏,存 localStorage
// (与 enablement 同款前端偏好,不进 SQLite)。运行时在能力目录 / 动作菜单 / 按需 transformer
// 处实时过滤;隐藏与「禁用」语义不同——禁用可开回,隐藏不提供恢复入口。
// 自定义 Agent 的「删除」走 DB 真删,不走这里。

const KEY = "hiddenAgents";
let cache: Set<string> | null = null;

function hidden(): Set<string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    cache = new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

export function isAgentHidden(id: string): boolean {
  return hidden().has(id);
}

export function hideAgent(id: string): void {
  const set = hidden();
  set.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // 测试环境无 localStorage:仅内存缓存生效
  }
}
