import { invoke } from "@tauri-apps/api/core";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseUrl: string;
}

// Runs in Rust (see src-tauri/src/update_check.rs): the webview CSP does not
// allow the frontend to reach api.github.com directly.
export function checkForUpdate(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>("check_for_update");
}
