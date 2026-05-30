import { useState } from "react";
import { explainReply, MissingApiKeyError } from "../orchestrator";
import { Markdown } from "./Markdown";

// "讲解"按钮:点一下,按用户掌握情况流式讲解这条回复。
// 状态留在组件内(临时,不持久化)——再点收起/展开,已生成的复用。
export function ReplyExplanation({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setExplanation("");
    let acc = "";
    try {
      await explainReply(text, (d) => {
        acc += d;
        setExplanation(acc);
      });
    } catch (e) {
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClick() {
    if (loading) return;
    if (!explanation && !error) {
      setOpen(true);
      void generate();
      return;
    }
    setOpen((o) => !o);
  }

  const label = loading
    ? "讲解中…"
    : open && (explanation || error)
      ? "收起讲解"
      : "讲解";

  return (
    <div className="explain-wrap">
      <button
        type="button"
        className="explain-btn"
        onClick={handleClick}
        disabled={loading}
        title="根据你的掌握情况讲解这条回复"
      >
        {label}
      </button>
      {open && (explanation || error) && (
        <div className="explain-panel">
          {error ? (
            <span className="explain-error" role="alert">
              {error}
            </span>
          ) : (
            <div className="explain-body">
              <Markdown>{explanation}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
