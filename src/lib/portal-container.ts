/** Radix portals default to `document.body`, outside `.codex-shell` token overrides. */
export function getAppPortalContainer(): HTMLElement | undefined {
  const overlayPortal = document.querySelector<HTMLElement>(
    "[data-app-portal-root]",
  );
  if (overlayPortal) return overlayPortal;
  return document.querySelector<HTMLElement>(".codex-shell") ?? undefined;
}
