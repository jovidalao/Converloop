import { cn } from "@/lib/utils";

// Loading spinner that inherits the current text color. Size via className
// (e.g. size-3.5); default ~13px to match the old inline spinners.
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-[13px] animate-spin rounded-full border-2 border-current/30 border-t-current bg-transparent",
        className,
      )}
    />
  );
}
