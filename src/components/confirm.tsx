import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
import { getAppPortalContainer } from "@/lib/portal-container";

/**
 * A promise-based confirmation dialog. Replaces the native window.confirm() —
 * which in Tauri's macOS WKWebView doesn't show a dialog and just returns false,
 * making delete-style actions feel like "nothing happened" on click. Usage:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete conversation "X"?', description: "This can't be undone." })) { ... }
 */
type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
};

const ConfirmContext = createContext<
  ((options: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm)
    throw new Error("useConfirm must be used within <ConfirmProvider>");
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  function settle(result: boolean) {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <AlertDialog.Portal container={getAppPortalContainer()}>
          <AlertDialog.Overlay className="fixed inset-0 z-[200] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[201] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-modal-small data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <AlertDialog.Title className="text-ui-title font-semibold">
              {options?.title}
            </AlertDialog.Title>
            {options?.description && (
              <AlertDialog.Description className="mt-1.5 text-ui-body text-ui-muted">
                {options.description}
              </AlertDialog.Description>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="ghost" size="sm">
                  {options?.cancelText ?? t("common.cancel")}
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => settle(true)}
                >
                  {options?.confirmText ?? t("common.delete")}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
