import { Component, type ErrorInfo, type ReactNode } from "react";
import { logError } from "@/lib/log";
import { Button } from "./ui/button";

interface State {
  error: Error | null;
}

// 根级兜底:任意组件渲染抛错时,显示可恢复的错误页而不是整窗白屏。
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
            出了点问题
          </p>
          <p className="max-w-md text-ui-body text-ui-muted">
            {this.state.error.message}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          重新加载
        </Button>
      </div>
    );
  }
}
