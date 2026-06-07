// Lightweight platform detection for window-chrome / styling decisions.
// The webview UA is reliable across our targets: WebView2 (Windows) contains
// "Windows", WKWebView (macOS) contains "Macintosh". Synchronous (no plugin) so
// it can run before first paint to avoid chrome flicker. Guarded for non-browser
// (test / SSR) contexts where navigator is undefined.
function ua(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

export function isWindows(): boolean {
  return /windows/i.test(ua());
}

export function isMacOS(): boolean {
  return /macintosh|mac os x/i.test(ua());
}

export type PlatformName = "windows" | "macos" | "other";

export function platformName(): PlatformName {
  if (isWindows()) return "windows";
  if (isMacOS()) return "macos";
  return "other";
}
