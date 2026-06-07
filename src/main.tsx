import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./components/confirm";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./components/theme-provider";
import { LocaleProvider } from "./i18n";
import { platformName } from "./lib/platform";
import { ensureDefaultApiKeys } from "./secrets/bootstrap";
import "./index.css";

// Drives platform-specific chrome via CSS (e.g. [data-platform="windows"]).
// Set before render so the topbar lays out correctly on first paint.
document.documentElement.dataset.platform = platformName();

void ensureDefaultApiKeys();

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
