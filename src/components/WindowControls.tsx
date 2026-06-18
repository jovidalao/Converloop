import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";

// Caption controls for the frameless Windows window: minimize / maximize-restore
// / close, flush to the top-right corner of the topbar. macOS uses native traffic
// lights (top-left) instead, so the caller renders this only on Windows. Buttons
// are <button>s inside the drag region, so the global `[data-tauri-drag-region]
// button { app-region: no-drag }` rule keeps them clickable and startTopbarDrag
// already bails on button targets.

function MinimizeGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function RestoreGlyph() {
  // Front square (bottom-left) plus the back square's top and right edges.
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1"
        y="3"
        width="6"
        height="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M3 3V1h6v6H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const win = getCurrentWindow();
  return (
    <div className="win-controls" data-no-window-drag>
      <button
        type="button"
        className="win-control"
        onClick={() => void win.minimize()}
        aria-label={t("app.windowMinimize")}
        title={t("app.windowMinimize")}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="win-control"
        onClick={() => void win.toggleMaximize()}
        aria-label={
          maximized ? t("app.windowRestore") : t("app.windowMaximize")
        }
        title={maximized ? t("app.windowRestore") : t("app.windowMaximize")}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        className="win-control win-control-close"
        onClick={() => void win.close()}
        aria-label={t("app.windowClose")}
        title={t("app.windowClose")}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
