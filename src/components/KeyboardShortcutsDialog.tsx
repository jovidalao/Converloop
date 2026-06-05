import { XIcon } from "lucide-react";
import { useEffect } from "react";
import { APP_ACTIONS } from "@/lib/app-actions";
import { Button } from "./ui/button";

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-border/70 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted shadow-minimal-flat">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="键盘快捷键"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 只阻止背景关闭 */}
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-modal-small"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-ui-body font-semibold">键盘快捷键</h2>
            <p className="mt-0.5 mb-0 text-ui-caption text-ui-muted">
              常用操作都可以从键盘完成。
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label="关闭"
          >
            <XIcon size={15} />
          </Button>
        </div>
        <div className="grid gap-1 p-2">
          {APP_ACTIONS.map((shortcut) => (
            <div
              key={`${shortcut.keys.join("+")}:${shortcut.label}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-ui-body"
            >
              <span className="min-w-0 flex-1 text-foreground">
                {shortcut.label}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key) => (
                  <KeyCap key={key}>{key}</KeyCap>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
