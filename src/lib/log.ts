// 极简集中日志。错误始终打印;debug 信息由开关控制(默认关闭 → 行为不变):
//   localStorage["lang-agent.debug"] = "1"
// 没有引第三方 logger:单进程前端,console + 一个 scope 标签足够。
export function isDebug(): boolean {
  try {
    return localStorage.getItem("lang-agent.debug") === "1";
  } catch {
    return false;
  }
}

export function logDebug(scope: string, msg: string): void {
  if (isDebug()) console.info(`[${scope}] ${msg}`);
}

export function logError(scope: string, msg: string, err?: unknown): void {
  if (err === undefined) {
    console.error(`[${scope}] ${msg}`);
  } else {
    console.error(`[${scope}] ${msg}`, err);
  }
}
