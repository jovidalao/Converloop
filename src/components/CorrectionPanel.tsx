import type { TutorAnalysis } from "../agents/schema";

export function CorrectionPanel({
  analysis,
  busy,
}: {
  analysis: TutorAnalysis | null;
  busy: boolean;
}) {
  return (
    <aside className="correction">
      <h3>批改</h3>
      {busy && !analysis && <p className="muted">分析中…</p>}
      {!busy && !analysis && <p className="muted">还没有批改。发送一句开始。</p>}
      {analysis &&
        (analysis.is_correct ? (
          <p className="ok">
            ✓ 没有明显错误。
            {analysis.natural !== analysis.corrected && (
              <>
                <br />
                更地道:{analysis.natural}
              </>
            )}
          </p>
        ) : (
          <div>
            <p>
              <strong>改正:</strong>
              {analysis.corrected}
            </p>
            {analysis.natural !== analysis.corrected && (
              <p>
                <strong>更地道:</strong>
                {analysis.natural}
              </p>
            )}
            <ul className="issues">
              {analysis.issues.map((iss, i) => (
                <li key={i}>
                  <span className="cat">{iss.category}</span>{" "}
                  <del>{iss.span_original}</del> → <ins>{iss.span_corrected}</ins>
                  <div className="explain">{iss.explanation}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </aside>
  );
}
