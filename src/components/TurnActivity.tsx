import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type { TurnActivity, TurnActivityStatus } from "@/lib/turn-activity";
import { cn } from "@/lib/utils";

// Calm "thinking" state shown before the first reply tokens arrive. Replaces the
// bare bouncing dots with a labelled, pulsing indicator so the pre-reply gap has
// a stable lifecycle instead of a flash (see craft-ui-plan §6 思考过程 UI).
export function ThinkingIndicator({
  label = "正在思考…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
      role="status"
      aria-label={label}
    >
      <span className="inline-flex items-center gap-1" aria-hidden>
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

const STATUS_DOT: Record<TurnActivityStatus, string> = {
  pending: "bg-muted-foreground/50",
  ok: "bg-success",
  info: "bg-primary",
  error: "bg-destructive",
};

// Low-noise, collapsed-by-default summary of what happened this turn beyond the
// reply itself (currently the memory writes). Expands to a compact activity
// list. Progressive disclosure: the stage stays light, detail is one click away.
export function TurnActivityRow({
  activities,
}: {
  activities: TurnActivity[];
}) {
  const [open, setOpen] = useState(false);
  if (activities.length === 0) return null;
  const summary = activities.map((a) => a.label).join(" · ");
  return (
    <div className="self-stretch">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-ml-1 flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </button>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-1 px-1.5 pt-0.5 pb-1">
          {activities.map((a, i) => (
            <li
              key={`${a.kind}:${i}`}
              className="flex items-start gap-2 text-xs leading-snug"
            >
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  STATUS_DOT[a.status],
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{a.label}</span>
                {a.preview && (
                  <span className="ml-1.5 text-muted-foreground">
                    {a.preview}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
