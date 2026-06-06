import { Component, type ErrorInfo, type ReactNode } from "react";
import { staticT } from "@/i18n";
import { logError } from "@/lib/log";
import { Button } from "./ui/button";

interface State {
  error: Error | null;
}

// Root-level fallback: when any component throws during render, show a
// recoverable error page instead of a fully blank window.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError("react", error.message, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="space-y-1">
          <p className="text-ui-title font-semibold text-foreground">
            {staticT("errorBoundary.title")}
          </p>
          <p className="max-w-md text-ui-body text-ui-muted">
            {this.state.error.message}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {staticT("errorBoundary.reload")}
        </Button>
      </div>
    );
  }
}
