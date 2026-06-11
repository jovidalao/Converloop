import { BookOpenCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

// Lesson start page (shown when a focused lesson is selected but not yet materialized): the learner reads what the
// lesson does, then chooses to begin. The DB row is created only after Start.
export function LessonStartScreen({
  name,
  description,
  busy,
  onStart,
}: {
  name: string;
  description: string;
  busy: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="m-auto flex w-full max-w-xl flex-col items-center gap-5 px-4 py-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center justify-center gap-2 text-ui-title font-semibold text-foreground">
          <BookOpenCheckIcon className="size-5 text-primary" />
          {name}
        </div>
        {description && (
          <p className="m-0 text-ui-body leading-relaxed text-ui-muted">
            {description}
          </p>
        )}
      </div>

      <div>
        <Button
          type="button"
          variant="ghost"
          className="border border-border bg-transparent px-4 hover:bg-accent"
          disabled={busy}
          onClick={onStart}
        >
          {t("chat.lessonStartButton")}
        </Button>
      </div>
    </div>
  );
}
