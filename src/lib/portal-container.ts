/** Radix portals default to `document.body`, outside `.codex-shell` token overrides. */
export function getAppPortalContainer(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(".codex-shell") ?? undefined;
}
