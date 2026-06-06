import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./components/confirm";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ThemeProvider } from "./components/theme-provider";
import { LocaleProvider } from "./i18n";
import { ensureDefaultApiKeys } from "./secrets/bootstrap";
import "./index.css";

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
