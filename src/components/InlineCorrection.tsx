import type { Issue, TutorAnalysis } from "../agents/schema";
import { SpeakableText } from "./SpeakButton";

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
  if (pending && !analysis && !proseFeedback) {
    return (
      <div className="inline-correction pending" aria-live="polite">
        <span className="inline-correction-spinner" aria-hidden />
        <span>正在分析你的表达…</span>
      </div>
    );
  }

  if (!analysis) {
    if (proseFeedback?.trim()) {
      return (
        <div className="inline-correction prose-feedback">
          <div className="inline-correction-header">
            <span className="inline-correction-icon warn-icon" aria-hidden>
              ✦
            </span>
            <span className="inline-correction-title">批改建议</span>
          </div>
          <pre className="inline-correction-prose">{proseFeedback.trim()}</pre>
        </div>
      );
    }
    if (error) {
      return (
        <div className="inline-correction failed" role="alert">
          <span className="inline-correction-title">批改未完成</span>
          <p className="inline-correction-error">{error}</p>
        </div>
      );
    }
    return null;
  }

  const natural = analysis.natural ?? "";
  const corrected = analysis.corrected ?? "";
  const showNatural =
    natural !== corrected && natural.trim().length > 0;

  if (analysis.is_correct && analysis.issues.length === 0) {
    return (
      <div className="inline-correction ok">
        <div className="inline-correction-header">
          <span className="inline-correction-icon ok-icon" aria-hidden>
            ✓
          </span>
          <span className="inline-correction-title">表达正确</span>
        </div>
        {showNatural && (
          <div className="inline-correction-sentence natural">
            <span className="inline-correction-label">更地道</span>
            <SpeakableText text={natural} />
          </div>
        )}
        {error && <p className="inline-correction-warn">{error}</p>}
      </div>
    );
  }

  return (
    <div className="inline-correction has-issues">
      <div className="inline-correction-header">
        <span className="inline-correction-icon warn-icon" aria-hidden>
          ✦
        </span>
        <span className="inline-correction-title">批改建议</span>
      </div>

      {!analysis.is_correct && (
        <div className="inline-correction-sentence">
          <span className="inline-correction-label">改正</span>
          <SpeakableText text={corrected} />
        </div>
      )}

      {showNatural && (
        <div className="inline-correction-sentence natural">
          <span className="inline-correction-label">更地道</span>
          <SpeakableText text={natural} />
        </div>
      )}

      {error && <p className="inline-correction-warn">{error}</p>}

      {analysis.issues.length > 0 && (
        <ul className="inline-correction-issues">
          {analysis.issues.map((iss, i) => (
            <li key={i} className={SEVERITY_CLASS[iss.severity]}>
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
      )}
    </div>
  );
}
