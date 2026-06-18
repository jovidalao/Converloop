import { forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils";

// Word-slot answer field (matches the dictation reference): one underline per word of the target
// sentence — hinting how many words to produce — with the learner's typed words filling them left to
// right and the word being typed highlighted. A single transparent textarea is overlaid (ref-forwarded
// for focus) and captures ALL input, so IME, paste and grading keep working on one plain string; the
// slots are a purely derived visual. Slots wrap to multiple rows, so long sentences need no scrolling.
export const WordSlotsInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    /** Number of words in the target sentence — the number of hint underlines shown. */
    targetWordCount: number;
    ariaLabel: string;
  }
>(({ value, onChange, onKeyDown, targetWordCount, ariaLabel }, ref) => {
  const { tokens, activeIndex } = useMemo(() => {
    const toks = value.split(/\s+/).filter(Boolean);
    // The slot being typed: the last word, or a fresh empty slot right after a space.
    const active = /\s$/.test(value)
      ? toks.length
      : Math.max(0, toks.length - 1);
    return { tokens: toks, activeIndex: active };
  }, [value]);

  // Always show at least the target's worth of slots (the word-count hint); grow if the learner
  // overshoots so every typed word stays visible.
  const slotCount = Math.max(
    targetWordCount,
    tokens.length,
    activeIndex + 1,
    1,
  );

  return (
    <div className="relative w-full">
      <div
        aria-hidden
        className="flex flex-wrap items-end justify-center gap-x-3 gap-y-3 px-2 py-2"
      >
        {Array.from({ length: slotCount }, (_, i) => {
          const word = tokens[i] ?? "";
          const active = i === activeIndex;
          const extra = i >= targetWordCount; // typed more words than the target has
          return (
            <span
              key={i}
              className="inline-flex min-w-[3rem] flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "px-1 text-xl leading-relaxed",
                  extra ? "text-destructive" : "text-foreground",
                )}
              >
                {word || " "}
              </span>
              <span
                className={cn(
                  "h-[2px] w-full rounded-full transition-colors",
                  extra
                    ? "bg-destructive/60"
                    : active
                      ? "bg-primary"
                      : word
                        ? "bg-foreground/40"
                        : "bg-border",
                )}
              />
            </span>
          );
        })}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        aria-label={ariaLabel}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="absolute inset-0 size-full cursor-text resize-none bg-transparent text-transparent caret-transparent outline-none"
      />
    </div>
  );
});
WordSlotsInput.displayName = "WordSlotsInput";
