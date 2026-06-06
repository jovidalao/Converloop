import {
  BookOpenIcon,
  CheckIcon,
  LanguagesIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Issue, TutorAnalysis } from "../agents/schema";
import { SpeakableText } from "./SpeakButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export const SEVERITY_COLOR: Record<Issue["severity"], string> = {
  minor: "text-ui-muted",
  moderate: "text-warning",
  major: "text-destructive",
};

type DiffSegment =
  | { kind: "same"; text: string }
  | { kind: "change"; original: string; corrected: string };

const isWordChar = (ch: string | undefined): boolean =>
  !!ch && /[\p{L}\p{N}]/u.test(ch);

// Find a span on word boundaries: when an end is a letter/digit, require a
// standalone word, so a short span (like "is") doesn't match inside a bigger
// word (like "th[is]"). Returns -1 when no valid position is found (the caller
// skips it).
function indexOfWord(hay: string, needle: string, from: number): number {
  if (!needle) return -1;
  const guardStart = isWordChar(needle[0]);
  const guardEnd = isWordChar(needle[needle.length - 1]);
  let idx = hay.indexOf(needle, from);
  while (idx !== -1) {
    const end = idx + needle.length;
    const leftOk = !guardStart || idx === 0 || !isWordChar(hay[idx - 1]);
    const rightOk = !guardEnd || end === hay.length || !isWordChar(hay[end]);
    if (leftOk && rightOk) return idx;
    idx = hay.indexOf(needle, idx + 1);
  }
  return -1;
}

// Rebuild the original sentence into an inline diff from the issues: wrong spans
// get a red strikethrough followed by the green correction. Issues that can't be
// located are skipped (they still appear under "Grammar details"), so it always
// renders.
export function buildDiffSegments(
  original: string,
  issues: Issue[],
): DiffSegment[] {
  type Placed = { idx: number; end: number; corrected: string };
  const placed: Placed[] = [];
  let from = 0;
  for (const iss of issues) {
    const span = iss.span_original;
    if (!span || span === iss.span_corrected) continue;
    let idx = indexOfWord(original, span, from);
    if (idx === -1) idx = indexOfWord(original, span, 0);
    if (idx === -1) continue;
    placed.push({ idx, end: idx + span.length, corrected: iss.span_corrected });
    from = idx + span.length;
  }
  placed.sort((a, b) => a.idx - b.idx);

  const segments: DiffSegment[] = [];
  let cursor = 0;
  for (const p of placed) {
    if (p.idx < cursor) continue; // overlaps, discard
    if (p.idx > cursor)
      segments.push({ kind: "same", text: original.slice(cursor, p.idx) });
    segments.push({
      kind: "change",
      original: original.slice(p.idx, p.end),
      corrected: p.corrected,
    });
    cursor = p.end;
  }
  if (cursor < original.length)
    segments.push({ kind: "same", text: original.slice(cursor) });
  return segments;
}

// A sentence in the user's bubble: shows an inline diff when there's a locatable
// correction, otherwise plain text.
export function UserSentence({
  text,
  analysis,
  nativeLanguage,
}: {
  text: string;
  analysis: TutorAnalysis | null;
  nativeLanguage?: string;
}) {
  const { t } = useTranslation();
  // Native-language / mixed turn: show as-is + a badge (with the native language
  // name), without the red/green diff.
  if (analysis?.expression_gap) {
    return (
      <span className="align-middle">
        <span
          className="mr-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent px-1.5 py-0.5 align-middle text-ui-caption font-semibold leading-none text-primary"
          title={t("corrections.nativeInputTitle")}
        >
          <LanguagesIcon size={12} />
          {nativeLanguage?.trim() || t("corrections.nativeFallback")}
        </span>
        {text}
      </span>
    );
  }
  if (!analysis || analysis.is_correct || analysis.issues.length === 0) {
    return <>{text}</>;
  }
  const segments = buildDiffSegments(text, analysis.issues);
  const hasDiff = segments.some((s) => s.kind === "change");
  if (!hasDiff) return <>{text}</>;

  return (
    <span>
      {segments.map((seg, i) =>
        seg.kind === "same" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span key={i}>
            <del className="text-destructive line-through decoration-destructive decoration-[1.5px]">
              {seg.original}
            </del>{" "}
            <ins className="font-semibold text-success no-underline">
              {seg.corrected}
            </ins>
          </span>
        ),
      )}
    </span>
  );
}

export function InlineCorrection({
  analysis,
  proseFeedback,
  pending,
  error,
  leading,
  natural,
}: {
  analysis: TutorAnalysis | null;
  proseFeedback?: string | null;
  pending: boolean;
  error?: string | null;
  // Other actions rendered earlier on the same row (copy / play), to the left of
  // the toggle buttons.
  leading?: ReactNode;
  // "Natural expression" toggle: the content shows inside the user's bubble (see
  // ChatView); here we only provide the toggle button.
  natural?: { open: boolean; onToggle: () => void };
}) {
  const { t } = useTranslation();
  // Explanation expanded by default, grammar details collapsed by default; each
  // icon toggles its own.
  const [gapOpen, setGapOpen] = useState(true);
  const [grammarOpen, setGrammarOpen] = useState(false);

  const gap = analysis?.expression_gap ?? null;
  const hasIssues = !!analysis && analysis.issues.length > 0;
  const allCorrect = !!analysis && !gap && analysis.is_correct && !hasIssues;
  const showPending = pending && !analysis && !proseFeedback;
  const showProse = !analysis && !!proseFeedback?.trim();

  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      <div className="-mr-1 flex items-center gap-0.5">
        {leading}
        {showPending && (
          <span
            className="inline-flex items-center gap-1.5 px-0.5 py-0.5 text-ui-body text-ui-muted"
            aria-live="polite"
          >
            <Spinner />
            {t("corrections.analyzing")}
          </span>
        )}
        {allCorrect && (
          <span className="inline-flex items-center gap-1 px-1.5 py-1 text-ui-caption text-success">
            <CheckIcon size={14} />
            {t("corrections.correct")}
          </span>
        )}
        {gap && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={gapOpen}
            aria-expanded={gapOpen}
            onClick={() => setGapOpen((v) => !v)}
          >
            <LanguagesIcon size={15} />
            {t("corrections.explain")}
          </Button>
        )}
        {natural && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={natural.open}
            aria-expanded={natural.open}
            onClick={natural.onToggle}
          >
            <SparklesIcon size={15} />
            {t("corrections.naturalExpression")}
          </Button>
        )}
        {hasIssues && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={grammarOpen}
            aria-expanded={grammarOpen}
            onClick={() => setGrammarOpen((v) => !v)}
          >
            <BookOpenIcon size={15} />
            {t("corrections.grammarDetails")}
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-background px-1 text-ui-caption font-bold text-ui-muted">
              {analysis?.issues.length ?? 0}
            </span>
          </Button>
        )}
      </div>

      {gap && gapOpen && (
        <div className="flex w-full animate-in flex-col gap-2.5 rounded-lg border bg-card p-3 text-ui-body leading-normal shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
              {t("corrections.naturalExpression")}
            </span>
            <SpeakableText text={gap.target_expression} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
              {t("corrections.explanationHeader")}
            </span>
            <p className="m-0 leading-relaxed text-foreground">
              {gap.explanation}
            </p>
          </div>
          {gap.key_items.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
                {t("corrections.keyItems")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {gap.key_items.map((it, i) => (
                  <span
                    key={i}
                    className="inline-flex items-baseline gap-1.5 rounded-md border bg-background px-2 py-1"
                    title={it.gloss}
                  >
                    <span className="font-semibold text-foreground">
                      {it.text}
                    </span>
                    <span className="text-ui-caption text-ui-muted">
                      {it.gloss}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {gap.usage_note?.trim() && (
            <p className="m-0 text-ui-body leading-snug text-ui-muted">
              {gap.usage_note.trim()}
            </p>
          )}
        </div>
      )}

      {hasIssues && grammarOpen && analysis && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 text-ui-body shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <ul className="m-0 flex list-none flex-col p-0">
            {analysis.issues.map((iss, i) => (
              <li
                key={i}
                className="border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="rounded bg-accent px-1.5 py-0.5 text-ui-caption font-semibold uppercase tracking-wide text-primary">
                    {t(`corrections.category.${iss.category}`)}
                  </span>
                  <span
                    className={cn(
                      "text-ui-caption uppercase",
                      SEVERITY_COLOR[iss.severity],
                    )}
                  >
                    {t(`corrections.severity.${iss.severity}`)}
                  </span>
                </div>
                <p className="m-0 text-ui-body">
                  <del className="text-destructive line-through decoration-destructive">
                    {iss.span_original}
                  </del>
                  <span
                    className="mx-1.5 text-ui-caption text-ui-muted"
                    aria-hidden
                  >
                    →
                  </span>
                  <ins className="font-medium text-success no-underline">
                    {iss.span_corrected}
                  </ins>
                </p>
                <p className="mt-1.5 mb-0 text-ui-body leading-snug text-ui-muted">
                  {iss.explanation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showProse && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 text-ui-body shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <pre className="m-0 whitespace-pre-wrap break-words font-sans text-foreground">
            {proseFeedback!.trim()}
          </pre>
        </div>
      )}

      {error && (
        <pre
          className="m-0 max-w-full whitespace-pre-wrap break-words font-sans text-ui-body leading-snug text-destructive"
          role="alert"
        >
          {error}
        </pre>
      )}
    </div>
  );
}
