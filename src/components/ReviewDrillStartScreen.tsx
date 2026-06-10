import { TargetIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/i18n";
import type { ReviewDrillItem } from "../db/conversations";
import { getReviewDueList } from "../db/mastery";

// Weak-spot drill start page (shown on an empty review-drill draft): code — not the model — selects the due-for-review
// items (getReviewDueList) and shows exactly what will be drilled. Start snapshots the items into the conversation's
// modifiers and kicks off the retrieval drill. No LLM call happens before Start.
export function ReviewDrillStartScreen({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart: (items: ReviewDrillItem[]) => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ReviewDrillItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getReviewDueList(5).then((rows) => {
      if (cancelled) return;
      setItems(
        rows.map((row) => ({
          key: row.key,
          label: row.label,
          type: row.type,
          example: row.example,
          notes: row.notes,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-5 pt-4 pb-2">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-ui-title font-semibold text-foreground">
          <TargetIcon className="size-5 text-primary" />
          {t("reviewDrill.startTitle")}
        </div>
        <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
          {t("reviewDrill.startDescription")}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-ui-caption font-medium text-ui-muted">
          {t("reviewDrill.itemsLabel")}
        </span>
        {items === null ? (
          <div className="flex items-center gap-2 text-ui-body text-ui-muted">
            <Spinner className="size-3.5" />
            {t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
            {t("reviewDrill.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-baseline gap-2 rounded-lg border bg-card px-3 py-2 text-ui-body"
              >
                <span className="min-w-0 flex-1 font-medium text-foreground">
                  {item.label}
                </span>
                <span className="shrink-0 text-ui-caption text-ui-muted">
                  {item.type}
                </span>
              </div>
            ))}
          </div>
        )}
        {items !== null && items.length > 0 && (
          <Button
            type="button"
            className="mt-1 self-start"
            disabled={busy}
            onClick={() => onStart(items)}
          >
            <TargetIcon className="size-4" />
            {t("reviewDrill.start")}
          </Button>
        )}
      </div>
    </div>
  );
}
