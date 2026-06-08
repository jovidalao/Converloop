import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { ZapIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

// Rapid-fire Q&A setup: the learner types one umbrella scenario; on start the app creates a practice conversation
// with the quickfire modifier and the AI begins firing concrete situations. Open state is controlled by the parent.
export function QuickfireSetupDialog({
  open,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onSubmit: (scenario: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the field each time the dialog opens so a previous draft doesn't linger.
  useEffect(() => {
    if (open) setScenario("");
  }, [open]);

  function submit() {
    const value = scenario.trim();
    if (!value) return;
    onSubmit(value);
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            // Default focus would land on Cancel; for an input dialog focus the scenario field instead.
            e.preventDefault();
            textareaRef.current?.focus();
          }}
        >
          <AlertDialog.Title className="flex items-center gap-2 text-ui-title font-semibold">
            <ZapIcon className="size-4 text-primary" />
            {t("quickfire.title")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-ui-body text-ui-muted">
            {t("quickfire.description")}
          </AlertDialog.Description>
          <textarea
            ref={textareaRef}
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            rows={3}
            placeholder={t("quickfire.placeholder")}
            className="mt-4 w-full resize-none rounded-lg border bg-background px-3 py-2 text-ui-chat outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" size="sm">
                {t("common.cancel")}
              </Button>
            </AlertDialog.Cancel>
            <Button size="sm" disabled={!scenario.trim()} onClick={submit}>
              {t("quickfire.start")}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
