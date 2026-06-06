// Minimal centralized logging. Errors are always printed; debug output is controlled by a flag (default off → no behavior change):
//   localStorage["lang-agent.debug"] = "1"
// No third-party logger: single-process frontend, console + a scope label is sufficient.
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
