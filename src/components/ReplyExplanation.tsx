import { BookOpenIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { explainReply, MissingApiKeyError } from "../orchestrator";
import { Markdown } from "./Markdown";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// "讲解"按钮:点一下,按用户掌握情况流式讲解这条回复。
// 状态留在组件内(临时,不持久化)——再点收起/展开,已生成的复用。
// actions: 同一行靠前渲染的其它操作(复制 / 发音)。
export function ReplyExplanation({
  text,
  actions,
  trailingActions,
  onFirstOpen,
}: {
  text: string;
  actions?: ReactNode;
  trailingActions?: ReactNode;
  /** 用户首次点开讲解时触发一次(理解信号记账,见 db/turns)。 */
  onFirstOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const prevTextRef = useRef(text);

  // 回复被「重新生成」替换后,旧讲解不再对应,收起重置。
  useEffect(() => {
    if (prevTextRef.current === text) return;
    prevTextRef.current = text;
    setOpen(false);
    setExplanation("");
    setError(null);
  }, [text]);

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
      onFirstOpen?.(); // 用户主动请求讲解 → 理解吃力信号
      void generate();
      return;
    }
    setOpen((o) => !o);
  }

  const expanded = open && (explanation || error);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="-ml-1 flex items-center gap-0.5">
        {actions}
        <Button
          type="button"
          variant="action"
          size="action"
          data-active={!!expanded}
          onClick={handleClick}
          disabled={loading}
          aria-expanded={!!expanded}
          title="根据你的掌握情况讲解这条回复"
        >
          {loading ? <Spinner /> : <BookOpenIcon size={16} />}
          <span>讲解</span>
        </Button>
        {trailingActions}
      </div>
      {open && (explanation || error) && (
        <div className="w-full animate-in rounded-lg border bg-card p-3 shadow-sm fade-in-0 slide-in-from-bottom-1 duration-300">
          {error ? (
            <div className="flex items-center gap-3">
              <span
                className="min-w-0 flex-1 text-sm leading-snug text-destructive"
                role="alert"
              >
                {error}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1.5"
                disabled={loading}
                onClick={() => void generate()}
              >
                <RefreshCwIcon size={14} />
                重试
              </Button>
            </div>
          ) : (
            <div className="text-sm leading-normal text-foreground">
              <Markdown>{explanation}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
