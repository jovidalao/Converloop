import {
  BookOpenIcon,
  CheckIcon,
  InfoIcon,
  LanguagesIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from "react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Issue, TutorAnalysis } from "../agents/schema";
import { useConfig } from "../config";
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

// Word-level diff between the original sentence and a whole corrected sentence.
// Fallback for when the tutor returns a corrected sentence but no locatable issue
// spans (empty issues, or spans that aren't verbatim substrings of the original):
// the coach panel still shows this via analysis.corrected, so we mirror it here.
// Standard LCS over whitespace-preserving tokens; deleted/inserted runs coalesce
// into one change segment, with surrounding whitespace kept in "same" segments so
// sentence spacing is preserved.
export function buildWholeSentenceDiff(
  original: string,
  corrected: string,
): DiffSegment[] {
  const a = original.split(/(\s+)/).filter(Boolean);
  const b = corrected.split(/(\s+)/).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const pushSame = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "same") last.text += text;
    else segments.push({ kind: "same", text });
  };
  let del = "";
  let ins = "";
  const flush = () => {
    if (!del && !ins) return;
    // Lift surrounding whitespace out of the change into "same" segments so the
    // change holds only the differing words (matches the issue-based convention).
    const ref = ins || del;
    pushSame(/^\s*/.exec(ref)![0]);
    segments.push({
      kind: "change",
      original: del.trim(),
      corrected: ins.trim(),
    });
    pushSame(/\s*$/.exec(ref)![0]);
    del = "";
    ins = "";
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      pushSame(a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      del += a[i++];
    } else {
      ins += b[j++];
    }
  }
  while (i < n) del += a[i++];
  while (j < m) ins += b[j++];
  flush();
  return segments;
}

export function hasCorrectedSentenceChange(
  text: string,
  analysis: TutorAnalysis | null,
): boolean {
  if (!analysis || analysis.expression_gap || analysis.issues.length > 0)
    return false;
  const corrected = analysis.corrected?.trim();
  return !!corrected && !analysis.is_correct && corrected !== text.trim();
}

// Renders diff segments as inline red strikethrough + green correction. del/ins
// are rendered conditionally so pure insertions/deletions (only in the
// whole-sentence fallback) don't leave an empty strikethrough or stray space.
function DiffView({ segments }: { segments: DiffSegment[] }) {
  return (
    <span>
      {segments.map((seg, i) =>
        seg.kind === "same" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span key={i}>
            {seg.original && (
              <del className="text-destructive line-through decoration-destructive decoration-[1.5px]">
                {seg.original}
              </del>
            )}
            {seg.original && seg.corrected ? " " : null}
            {seg.corrected && (
              <ins className="font-semibold text-success no-underline">
                {seg.corrected}
              </ins>
            )}
          </span>
        ),
      )}
    </span>
  );
}

// A sentence in the user's bubble: shows an inline diff when there's a correction,
// otherwise plain text. Prefers the precise issue-span diff; falls back to a
// whole-sentence diff against analysis.corrected when no spans are locatable, so
// the main page never silently drops a correction the coach panel does show.
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
  if (!analysis) return <>{text}</>;

  // Precise issue-span diff takes priority.
  if (analysis.issues.length > 0) {
    const segments = buildDiffSegments(text, analysis.issues);
    if (segments.some((s) => s.kind === "change"))
      return <DiffView segments={segments} />;
  }

  // Fallback: the tutor corrected the sentence but the issue spans weren't
  // locatable. is_correct gates it so ignored capitalization/punctuation (which
  // flips is_correct to true) stays hidden, matching the old behavior.
  if (!analysis.is_correct) {
    const corrected = analysis.corrected?.trim();
    if (corrected && corrected !== text.trim()) {
      const segments = buildWholeSentenceDiff(text, corrected);
      if (segments.some((s) => s.kind === "change"))
        return <DiffView segments={segments} />;
    }
  }

  return <>{text}</>;
}

export function InlineCorrection({
  analysis,
  proseFeedback,
  pending,
  error,
  diagnostic,
  leading,
  activePanelId,
  setActivePanelId,
  panelIds,
  correction,
  natural,
  onRetry,
}: {
  analysis: TutorAnalysis | null;
  proseFeedback?: string | null;
  pending: boolean;
  error?: string | null;
  // Developer diagnostic for a degraded correction (failure chain, raw output
  // previews). Rendered behind a collapsed toggle — never as the error line.
  diagnostic?: string | null;
  // Other actions rendered earlier on the same row (copy / play), to the left of
  // the toggle buttons.
  leading?: ReactNode;
  activePanelId: string | null;
  setActivePanelId: Dispatch<SetStateAction<string | null>>;
  panelIds: {
    gap?: string;
    grammar?: string;
  };
  // Whole-sentence correction fallback: the bubble already shows an inline diff,
  // but the action row still needs a concrete correction affordance instead of
  // falling through to "no changes".
  correction?: { text: string; open: boolean; onToggle: () => void };
  // "Natural expression" toggle: the content shows inside the user's bubble (see
  // ChatView); here we only provide the toggle button.
  natural?: { open: boolean; onToggle: () => void };
  /** Retry generating correction when no structured/prose feedback exists. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const { actionLabels } = useConfig();
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  const gap = analysis?.expression_gap ?? null;
  const hasIssues = !!analysis && analysis.issues.length > 0;
  const gapOpen = !!panelIds.gap && activePanelId === panelIds.gap;
  const grammarOpen = !!panelIds.grammar && activePanelId === panelIds.grammar;
  const togglePanel = (panelId: string | undefined) => {
    if (!panelId) return;
    setActivePanelId((current) => (current === panelId ? null : panelId));
  };
  const allCorrect = !!analysis && !gap && analysis.is_correct && !hasIssues;
  const showPending = pending && !analysis && !proseFeedback;
  const showProse = !analysis && !!proseFeedback?.trim();
  // Catch-all so the row is never silently blank. Two real states fall through
  // the cases above: analysis arrived with nothing actionable (no issues, gap,
  // or natural rewrite — a model sometimes returns is_correct=false yet lists no
  // issues), or no analysis came back at all without an error. Surface each.
  const showFallback =
    !showPending &&
    !allCorrect &&
    !gap &&
    !hasIssues &&
    !correction &&
    !natural &&
    !showProse &&
    !error;
  const showRetry = !!onRetry && !pending && !analysis && !showProse;
  const showUnavailableRetry = showRetry && showFallback && !analysis;

  return (
    <div
      className="flex w-full flex-col items-end gap-1.5"
      data-selectable-context
    >
      <div className="-mr-1 flex flex-wrap items-center justify-end gap-0.5">
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
            <CheckIcon size={14} className="shrink-0" />
            {/* Specific praise when the tutor spotted something notable; the plain check otherwise. */}
            {analysis?.highlight?.trim() || t("corrections.correct")}
          </span>
        )}
        {showUnavailableRetry ? (
          <Button
            type="button"
            variant="action"
            size="action"
            className="gap-1 px-1.5 py-1 text-ui-caption text-ui-muted"
            title={t("corrections.retry")}
            aria-label={t("corrections.retry")}
            onClick={onRetry}
          >
            <InfoIcon size={14} />
            <span>{t("corrections.unavailable")}</span>
            <RefreshCwIcon className="size-3.5" />
          </Button>
        ) : showRetry ? (
          <Button
            type="button"
            variant="action"
            size="action"
            title={t("corrections.retry")}
            aria-label={t("corrections.retry")}
            onClick={onRetry}
          >
            <RefreshCwIcon />
            {actionLabels && (
              <span data-compact-label>{t("corrections.retry")}</span>
            )}
          </Button>
        ) : null}
        {showFallback && !showUnavailableRetry && (
          <span className="inline-flex items-center gap-1 px-1.5 py-1 text-ui-caption text-ui-muted">
            {analysis ? <CheckIcon size={14} /> : <InfoIcon size={14} />}
            {analysis
              ? t("corrections.noChanges")
              : t("corrections.unavailable")}
          </span>
        )}
        {gap && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={gapOpen}
            aria-expanded={gapOpen}
            title={t("corrections.explain")}
            onClick={() => togglePanel(panelIds.gap)}
          >
            <LanguagesIcon />
            {actionLabels && (
              <span data-compact-label>{t("corrections.explain")}</span>
            )}
          </Button>
        )}
        {correction && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={correction.open}
            aria-expanded={correction.open}
            title={t("corrections.languageCorrection")}
            onClick={correction.onToggle}
          >
            <BookOpenIcon />
            {actionLabels && (
              <span data-compact-label>
                {t("corrections.languageCorrection")}
              </span>
            )}
          </Button>
        )}
        {natural && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={natural.open}
            aria-expanded={natural.open}
            title={t("corrections.naturalExpression")}
            onClick={natural.onToggle}
          >
            <SparklesIcon />
            {actionLabels && (
              <span data-compact-label>
                {t("corrections.naturalExpression")}
              </span>
            )}
          </Button>
        )}
        {hasIssues && (
          <Button
            type="button"
            variant="action"
            size="action"
            data-active={grammarOpen}
            aria-expanded={grammarOpen}
            title={t("corrections.grammarDetails")}
            onClick={() => togglePanel(panelIds.grammar)}
          >
            <BookOpenIcon />
            {actionLabels && (
              <span data-compact-label>{t("corrections.grammarDetails")}</span>
            )}
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
          {gap.template?.trim() &&
            gap.template.trim() !== gap.target_expression.trim() && (
              <div className="flex flex-col gap-1">
                <span className="text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
                  {t("corrections.expressionTemplate")}
                </span>
                <p className="m-0 font-mono text-ui-body text-foreground">
                  {gap.template.trim()}
                </p>
              </div>
            )}
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

      {correction?.open && (
        <div className="flex w-full animate-in flex-col gap-1.5 rounded-lg border bg-card p-3 text-ui-body shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <span className="text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
            {t("corrections.correctedSentence")}
          </span>
          <SpeakableText text={correction.text} />
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

      {diagnostic && (
        <div className="flex w-full flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setDiagnosticOpen((open) => !open)}
            className="text-ui-caption text-ui-subtle transition-colors hover:text-ui-muted"
          >
            {showProse ? `${t("corrections.degraded")} · ` : ""}
            {diagnosticOpen
              ? t("corrections.hideDiagnostic")
              : t("corrections.showDiagnostic")}
          </button>
          {diagnosticOpen && (
            <pre className="m-0 max-w-full whitespace-pre-wrap break-words rounded-lg border bg-card p-3 text-ui-caption leading-snug text-ui-muted">
              {diagnostic}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
