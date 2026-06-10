import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./components/confirm";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./components/theme-provider";
import { LocaleProvider } from "./i18n";
import { platformName } from "./lib/platform";
import { startSettingsMirror } from "./lib/settings-mirror";
import { ensureDefaultApiKeys } from "./secrets/bootstrap";
import "./index.css";

// Drives platform-specific chrome via CSS (e.g. [data-platform="windows"]).
// Set before render so the topbar lays out correctly on first paint.
document.documentElement.dataset.platform = platformName();

void ensureDefaultApiKeys();

async function boot() {
  // Restore mirrored user settings (provider config, locale, theme, macros…)
  // from SQLite before anything reads localStorage; no-op when nothing is lost.
  // Hard-capped: first paint must never hang on the DB — if the restore isn't
  // done quickly (e.g. slow first migration), render now and let it finish in
  // the background (a restore that lands late still helps the next launch).
  if ("__TAURI_INTERNALS__" in window) {
    const restore = startSettingsMirror().catch(() => {});
    await Promise.race([
      restore,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <LocaleProvider>
          <ThemeProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ThemeProvider>
        </LocaleProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

void boot();
