import {
  BookOpenIcon,
  CheckIcon,
  LanguagesIcon,
  SparklesIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import type { Issue, TutorAnalysis } from "../agents/schema";
import { SpeakableText } from "./SpeakButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

const CATEGORY_LABEL: Record<Issue["category"], string> = {
  grammar: "语法",
  word_choice: "用词",
  collocation: "搭配",
  spelling: "拼写",
  punctuation: "标点",
  register: "语体",
  naturalness: "自然度",
};

const SEVERITY_COLOR: Record<Issue["severity"], string> = {
  minor: "text-muted-foreground",
  moderate: "text-warning",
  major: "text-destructive",
};

const SEVERITY_LABEL: Record<Issue["severity"], string> = {
  minor: "轻微",
  moderate: "中等",
  major: "严重",
};

type DiffSegment =
  | { kind: "same"; text: string }
  | { kind: "change"; original: string; corrected: string };

const isWordChar = (ch: string | undefined): boolean =>
  !!ch && /[\p{L}\p{N}]/u.test(ch);

// 按词边界查找 span:两端是字母/数字时要求是独立单词,避免短 span(如 "is")
// 命中更大单词的内部(如 "th[is]")。找不到合规位置返回 -1(交由调用方跳过)。
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

// 把原句按 issues 重建成 inline diff:错的 span 标红删除线,后面跟绿色改写。
// 定位不到的 issue 直接跳过(仍会出现在「语法详解」里),所以永远能渲染。
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
    if (p.idx < cursor) continue; // 重叠,丢弃
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

// 用户气泡里的句子:有可定位的批改时显示 inline diff,否则纯文本。
export function UserSentence({
  text,
  analysis,
  nativeLanguage,
}: {
  text: string;
  analysis: TutorAnalysis | null;
  nativeLanguage?: string;
}) {
  // 母语/混说轮:原样显示 + 角标(直接标出母语名),不做红绿 diff。
  if (analysis?.expression_gap) {
    return (
      <span className="align-middle">
        <span
          className="mr-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent px-1.5 py-0.5 align-middle text-xs font-semibold leading-none text-primary"
          title="用母语/混说输入"
        >
          <LanguagesIcon size={12} />
          {nativeLanguage?.trim() || "母语"}
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
  // 同一行靠前渲染的其它操作(复制 / 播放),放在切换按钮左边。
  leading?: ReactNode;
  // 「地道表达」切换:内容显示在用户气泡内(见 ChatView),此处只给开关按钮。
  natural?: { open: boolean; onToggle: () => void };
}) {
  // 讲解默认展开,语法详解默认收起;各 icon 各自切换。
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
            className="inline-flex items-center gap-1.5 px-0.5 py-0.5 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Spinner />
            正在分析…
          </span>
        )}
        {allCorrect && (
          <span className="inline-flex items-center gap-1 px-1.5 py-1 text-xs text-success">
            <CheckIcon size={14} />
            表达正确
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
            讲解
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
            地道表达
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
            语法详解
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-background px-1 text-xs font-bold text-muted-foreground">
              {analysis?.issues.length ?? 0}
            </span>
          </Button>
        )}
      </div>

      {gap && gapOpen && (
        <div className="flex w-full animate-in flex-col gap-2.5 rounded-lg border bg-card p-3 text-sm leading-normal shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              地道表达
            </span>
            <SpeakableText text={gap.target_expression} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              讲解
            </span>
            <p className="m-0 leading-relaxed text-foreground">
              {gap.explanation}
            </p>
          </div>
          {gap.key_items.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                关键词 / 句式
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
                    <span className="text-xs text-muted-foreground">
                      {it.gloss}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {gap.usage_note?.trim() && (
            <p className="m-0 text-sm leading-snug text-muted-foreground">
              {gap.usage_note.trim()}
            </p>
          )}
        </div>
      )}

      {hasIssues && grammarOpen && analysis && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 text-sm shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <ul className="m-0 flex list-none flex-col p-0">
            {analysis.issues.map((iss, i) => (
              <li
                key={i}
                className="border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    {CATEGORY_LABEL[iss.category]}
                  </span>
                  <span
                    className={cn(
                      "text-xs uppercase",
                      SEVERITY_COLOR[iss.severity],
                    )}
                  >
                    {SEVERITY_LABEL[iss.severity]}
                  </span>
                </div>
                <p className="m-0 text-sm">
                  <del className="text-destructive line-through decoration-destructive">
                    {iss.span_original}
                  </del>
                  <span
                    className="mx-1.5 text-xs text-muted-foreground"
                    aria-hidden
                  >
                    →
                  </span>
                  <ins className="font-medium text-success no-underline">
                    {iss.span_corrected}
                  </ins>
                </p>
                <p className="mt-1.5 mb-0 text-sm leading-snug text-muted-foreground">
                  {iss.explanation}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showProse && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 text-sm shadow-sm fade-in-0 slide-in-from-bottom-1 duration-200">
          <pre className="m-0 whitespace-pre-wrap break-words font-sans text-foreground">
            {proseFeedback!.trim()}
          </pre>
        </div>
      )}

      {error && (
        <p className="text-sm leading-snug text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
