import { useState } from "react";
import type { Issue, TutorAnalysis } from "../agents/schema";
import { SpeakableText } from "./SpeakButton";
import { IconSparkles, IconBookOpen, IconCheck, IconLanguages } from "./icons";

const CATEGORY_LABEL: Record<Issue["category"], string> = {
  grammar: "语法",
  word_choice: "用词",
  collocation: "搭配",
  spelling: "拼写",
  punctuation: "标点",
  register: "语体",
  naturalness: "自然度",
};

const SEVERITY_CLASS: Record<Issue["severity"], string> = {
  minor: "sev-minor",
  moderate: "sev-moderate",
  major: "sev-major",
};

const SEVERITY_LABEL: Record<Issue["severity"], string> = {
  minor: "轻微",
  moderate: "中等",
  major: "严重",
};

type DiffSegment =
  | { kind: "same"; text: string }
  | { kind: "change"; original: string; corrected: string };

// 把原句按 issues 重建成 inline diff:错的 span 标红删除线,后面跟绿色改写。
// 定位不到的 issue 直接跳过(仍会出现在「语法详解」里),所以永远能渲染。
function buildDiffSegments(original: string, issues: Issue[]): DiffSegment[] {
  type Placed = { idx: number; end: number; corrected: string };
  const placed: Placed[] = [];
  let from = 0;
  for (const iss of issues) {
    const span = iss.span_original;
    if (!span || span === iss.span_corrected) continue;
    let idx = original.indexOf(span, from);
    if (idx === -1) idx = original.indexOf(span);
    if (idx === -1) continue;
    placed.push({ idx, end: idx + span.length, corrected: iss.span_corrected });
    from = idx + span.length;
  }
  placed.sort((a, b) => a.idx - b.idx);

  const segments: DiffSegment[] = [];
  let cursor = 0;
  for (const p of placed) {
    if (p.idx < cursor) continue; // 重叠,丢弃
    if (p.idx > cursor) segments.push({ kind: "same", text: original.slice(cursor, p.idx) });
    segments.push({
      kind: "change",
      original: original.slice(p.idx, p.end),
      corrected: p.corrected,
    });
    cursor = p.end;
  }
  if (cursor < original.length) segments.push({ kind: "same", text: original.slice(cursor) });
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
      <span className="native-sentence">
        <span className="native-badge" title="用母语/混说输入">
          <IconLanguages size={12} />
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
    <span className="sentence-diff">
      {segments.map((seg, i) =>
        seg.kind === "same" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span key={i}>
            <del className="diff-del">{seg.original}</del>{" "}
            <ins className="diff-ins">{seg.corrected}</ins>
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
}: {
  analysis: TutorAnalysis | null;
  proseFeedback?: string | null;
  pending: boolean;
  error?: string | null;
}) {
  // 讲解、更地道默认展开,语法详解默认收起;各 icon 各自切换。
  const [gapOpen, setGapOpen] = useState(true);
  const [naturalOpen, setNaturalOpen] = useState(true);
  const [grammarOpen, setGrammarOpen] = useState(false);

  if (pending && !analysis && !proseFeedback) {
    return (
      <div className="correction-pending" aria-live="polite">
        <span className="inline-correction-spinner" aria-hidden />
        <span>正在分析你的表达…</span>
      </div>
    );
  }

  if (!analysis) {
    if (proseFeedback?.trim()) {
      return (
        <div className="correction-panel">
          <pre className="inline-correction-prose">{proseFeedback.trim()}</pre>
        </div>
      );
    }
    if (error) {
      return <p className="correction-error" role="alert">{error}</p>;
    }
    return null;
  }

  const gap = analysis.expression_gap ?? null;
  const natural = analysis.natural ?? "";
  const corrected = analysis.corrected ?? "";
  // 母语/混说轮:讲解取代"更地道"与"表达正确";语法详解仍用于混说里的目标语错误。
  const showNatural = !gap && natural.trim().length > 0 && natural !== corrected;
  const hasIssues = analysis.issues.length > 0;
  const allCorrect = !gap && analysis.is_correct && !hasIssues;

  return (
    <div className="correction">
      <div className="correction-actions">
        {allCorrect && (
          <span className="correction-status">
            <IconCheck size={14} />
            表达正确
          </span>
        )}
        {gap && (
          <button
            type="button"
            className={`correction-toggle${gapOpen ? " active" : ""}`}
            aria-expanded={gapOpen}
            onClick={() => setGapOpen((v) => !v)}
          >
            <IconLanguages size={15} />
            讲解
          </button>
        )}
        {showNatural && (
          <button
            type="button"
            className={`correction-toggle${naturalOpen ? " active" : ""}`}
            aria-expanded={naturalOpen}
            onClick={() => setNaturalOpen((v) => !v)}
          >
            <IconSparkles size={15} />
            更地道
          </button>
        )}
        {hasIssues && (
          <button
            type="button"
            className={`correction-toggle${grammarOpen ? " active" : ""}`}
            aria-expanded={grammarOpen}
            onClick={() => setGrammarOpen((v) => !v)}
          >
            <IconBookOpen size={15} />
            语法详解
            <span className="correction-count">{analysis.issues.length}</span>
          </button>
        )}
      </div>

      {gap && gapOpen && (
        <div className="correction-panel gap-panel">
          <div className="gap-section">
            <span className="gap-label">地道表达</span>
            <SpeakableText text={gap.target_expression} />
          </div>
          <div className="gap-section">
            <span className="gap-label">讲解</span>
            <p className="gap-explanation">{gap.explanation}</p>
          </div>
          {gap.key_items.length > 0 && (
            <div className="gap-section">
              <span className="gap-label">关键词 / 句式</span>
              <div className="gap-chips">
                {gap.key_items.map((it, i) => (
                  <span key={i} className="gap-chip" title={it.gloss}>
                    <span className="gap-chip-text">{it.text}</span>
                    <span className="gap-chip-gloss">{it.gloss}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {gap.usage_note?.trim() && (
            <p className="gap-usage">{gap.usage_note.trim()}</p>
          )}
        </div>
      )}

      {showNatural && naturalOpen && (
        <div className="correction-panel">
          <SpeakableText text={natural} />
        </div>
      )}

      {hasIssues && grammarOpen && (
        <div className="correction-panel">
          <ul className="issues">
            {analysis.issues.map((iss, i) => (
              <li key={i}>
                <div className="issue-head">
                  <span className="issue-cat">{CATEGORY_LABEL[iss.category]}</span>
                  <span className={`issue-sev ${SEVERITY_CLASS[iss.severity]}`}>
                    {SEVERITY_LABEL[iss.severity]}
                  </span>
                </div>
                <p className="issue-diff">
                  <del>{iss.span_original}</del>
                  <span className="issue-arrow" aria-hidden>
                    →
                  </span>
                  <ins>{iss.span_corrected}</ins>
                </p>
                <p className="issue-explain">{iss.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="correction-error">{error}</p>}
    </div>
  );
}
