import { useState, type ReactNode } from "react";
import { explainReply, MissingApiKeyError } from "../orchestrator";
import { Markdown } from "./Markdown";
import { Spinner } from "./ui/spinner";
import { actionBtn, actionBtnActive } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { IconBookOpen } from "./icons";

// "讲解"按钮:点一下,按用户掌握情况流式讲解这条回复。
// 状态留在组件内(临时,不持久化)——再点收起/展开,已生成的复用。
// actions: 同一行靠前渲染的其它操作(复制 / 发音)。
export function ReplyExplanation({
  text,
  actions,
  trailingActions,
}: {
  text: string;
  actions?: ReactNode;
  trailingActions?: ReactNode;
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
    <div className="flex w-full flex-col gap-1.5">
      <div className="-ml-[0.3rem] flex items-center gap-0.5">
        {actions}
        <button
          type="button"
          className={cn(actionBtn, expanded && actionBtnActive)}
          onClick={handleClick}
          disabled={loading}
          aria-expanded={!!expanded}
          title="根据你的掌握情况讲解这条回复"
        >
          {loading ? <Spinner /> : <IconBookOpen size={16} />}
          <span>讲解</span>
        </button>
        {trailingActions}
      </div>
      {open && (explanation || error) && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 shadow-sm fade-in-0 slide-in-from-bottom-1 duration-300">
          {error ? (
            <span className="text-sm leading-snug text-destructive" role="alert">
              {error}
            </span>
          ) : (
            <div className="text-[0.82rem] leading-normal text-foreground">
              <Markdown>{explanation}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
