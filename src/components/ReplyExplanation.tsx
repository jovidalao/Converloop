import { useState, type ReactNode } from "react";
import { explainReply, MissingApiKeyError } from "../orchestrator";
import { Markdown } from "./Markdown";
import { IconBookOpen } from "./icons";

// "讲解"按钮:点一下,按用户掌握情况流式讲解这条回复。
// 状态留在组件内(临时,不持久化)——再点收起/展开,已生成的复用。
// actions: 同一行靠前渲染的其它操作(复制 / 发音)。
export function ReplyExplanation({
  text,
  actions,
}: {
  text: string;
  actions?: ReactNode;
}) {
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

  const expanded = open && (explanation || error);

  return (
    <div className="explain-wrap">
      <div className="msg-actions">
        {actions}
        <button
          type="button"
          className={`msg-action${expanded ? " active" : ""}`}
          onClick={handleClick}
          disabled={loading}
          aria-expanded={!!expanded}
          title="根据你的掌握情况讲解这条回复"
        >
          {loading ? (
            <span className="speak-btn-spinner" aria-hidden />
          ) : (
            <IconBookOpen size={16} />
          )}
          <span>讲解</span>
        </button>
      </div>
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
