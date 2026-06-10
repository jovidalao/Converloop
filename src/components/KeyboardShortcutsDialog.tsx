import { XIcon } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "@/i18n";
import { APP_ACTIONS, actionKeyCaps, useKeybindings } from "@/lib/app-actions";
import { useModalFocus } from "@/lib/modal-focus";
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
  const { t } = useTranslation();
  // Reflect custom chords as they change.
  useKeybindings();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    onClose,
  });

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("shortcutsDialog.ariaLabel")}
      data-modal-overlay
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the backdrop-close handler */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-modal-small"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-ui-body font-semibold">
              {t("shortcutsDialog.title")}
            </h2>
            <p className="mt-0.5 mb-0 text-ui-caption text-ui-muted">
              {t("shortcutsDialog.subtitle")}
            </p>
          </div>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <XIcon size={15} />
          </Button>
        </div>
        <div className="grid gap-1 p-2">
          {APP_ACTIONS.map((shortcut) => (
            <div
              key={shortcut.id}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-ui-body"
            >
              <span className="min-w-0 flex-1 text-foreground">
                {t(`actions.${shortcut.id}`)}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {actionKeyCaps(shortcut.id).map((key) => (
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
