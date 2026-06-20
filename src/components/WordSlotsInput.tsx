import { forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils";

export function dictationSlotWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
}

function dictationHintWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
}

export function applyDictationHint(
  value: string,
  targetText: string,
): string | null {
  const tokens = value.split(/\s+/).filter(Boolean);
  const activeIndex = /\s$/.test(value)
    ? tokens.length
    : Math.max(0, tokens.length - 1);
  const targetWords = dictationHintWords(targetText);
  const hint = targetWords[activeIndex];
  if (!hint) return null;

  const nextTokens = [...tokens];
  nextTokens[activeIndex] = hint;
  const shouldAdvance = activeIndex < targetWords.length - 1;
  return `${nextTokens.join(" ")}${shouldAdvance ? " " : ""}`;
}

// Word-slot answer field (matches the dictation reference): one underline per word of the target
// sentence. Each slot is sized by invisible renderings of both the target and typed word in the same
// font, plus horizontal breathing room and a minimum width. This keeps short-word lines usable, makes
// every line slightly wider than its target, and lets it grow when the learner types a longer word. A
// single transparent textarea is overlaid (ref-forwarded for focus) and captures ALL input, so IME,
// paste and grading keep working on one plain string; the slots are a purely derived visual. Slots wrap
// to multiple rows, so long sentences need no scrolling.
export const WordSlotsInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    /** Target sentence used only to derive the number and widths of the hint underlines. */
    targetText: string;
    ariaLabel: string;
  }
>(({ value, onChange, onKeyDown, targetText, ariaLabel }, ref) => {
  const { tokens, activeIndex } = useMemo(() => {
    const toks = value.split(/\s+/).filter(Boolean);
    // The slot being typed: the last word, or a fresh empty slot right after a space.
    const active = /\s$/.test(value)
      ? toks.length
      : Math.max(0, toks.length - 1);
    return { tokens: toks, activeIndex: active };
  }, [value]);
  const targetWords = useMemo(
    () => dictationSlotWords(targetText),
    [targetText],
  );
  const targetWordCount = targetWords.length;

  // Always show at least the target's worth of slots (the word-count hint); grow if the learner
  // overshoots so every typed word stays visible.
  const slotCount = Math.max(
    targetWordCount,
    tokens.length,
    activeIndex + 1,
    1,
  );

  return (
    <div className="relative w-full shrink-0">
      <div
        aria-hidden
        className="flex flex-wrap items-end justify-center gap-x-3 gap-y-3 px-2 py-2"
      >
        {Array.from({ length: slotCount }, (_, i) => {
          const word = tokens[i] ?? "";
          const active = i === activeIndex;
          const extra = i >= targetWordCount; // typed more words than the target has
          const targetWord = targetWords[i] ?? "";
          return (
            <span key={i} className="inline-flex min-w-12 flex-col gap-1.5">
              <span className="relative grid whitespace-nowrap px-1.5 text-xl leading-relaxed">
                <span className="invisible col-start-1 row-start-1">
                  {targetWord || " "}
                </span>
                <span className="invisible col-start-1 row-start-1">
                  {word || " "}
                </span>
                <span
                  className={cn(
                    "absolute inset-0 whitespace-nowrap text-center",
                    extra ? "text-destructive" : "text-foreground",
                  )}
                >
                  {word || " "}
                </span>
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
