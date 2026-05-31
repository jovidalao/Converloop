import { LanguagesIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MissingApiKeyError, translateSelection } from "../orchestrator";
import { Markdown } from "./Markdown";
import { Spinner } from "./ui/spinner";

interface Anchor {
  left: number; // 视口坐标:选区末尾
  top: number;
}

interface Pick {
  selection: string;
  context: string;
  anchor: Anchor;
}

const CARD_WIDTH = 340;

// 从当前 window 选区里取出:选中的文字 + 所在「可解析块」的整段文本 + 末尾位置。
// 选区必须落在 container 内、且祖先带 data-selectable-context(即消息正文)才算数。
function readPick(container: HTMLElement): Pick | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString().trim();
  if (!text) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const node = range.commonAncestorContainer;
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : (node as Element | null);
  const ctxEl = el?.closest<HTMLElement>("[data-selectable-context]");
  if (!ctxEl) return null;

  const rects = range.getClientRects();
  if (rects.length === 0) return null;
  const last = rects[rects.length - 1];

  return {
    selection: text,
    context: (ctxEl.textContent || text).trim(),
    anchor: { left: last.right, top: last.bottom },
  };
}

// 划词翻译浮窗:在消息区选中词/句 → 浮出按钮 → 点击后按语境流式给出母语解析。
// 不持久化,纯临时;换选区或点别处即消失。挂在 ChatView 的消息滚动区上。
export function TranslationPopover({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [open, setOpen] = useState(false); // 是否已展开结果卡(按钮 → 卡片)
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);

  const dismiss = useCallback(() => {
    setPick(null);
    setOpen(false);
    setResult("");
    setError(null);
    genRef.current++; // 作废进行中的流
  }, []);

  // 后台预取:选区一确定就开始流式生成,用户点开时内容已在路上/已就绪。
  // gen 守卫:换选区或关闭会自增 genRef,在途请求的回调与最终状态都作废。
  const startTranslate = useCallback(async (p: Pick, gen: number) => {
    setError(null);
    setResult("");
    let acc = "";
    try {
      await translateSelection(p.selection, p.context, (d) => {
        if (genRef.current !== gen) return;
        acc += d;
        setResult(acc);
      });
    } catch (e) {
      if (genRef.current !== gen) return;
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }, []);

  // 选区结束(mouseup)时重新计算:有有效选区就浮出按钮,否则收起。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onMouseUp(e: MouseEvent) {
      // 浮窗内部的点击(滚动结果卡等)不重算选区,免得把结果折回按钮。
      if (rootRef.current?.contains(e.target as Node)) return;
      const next = container ? readPick(container) : null;
      if (!next) {
        dismiss();
        return;
      }
      const gen = ++genRef.current;
      setPick(next);
      setOpen(false);
      void startTranslate(next, gen); // 不等点击,后台先跑
    }

    function onMouseDown(e: MouseEvent) {
      // 点在浮窗内部不收起;点别处(包括开始新的选择)先收起。
      if (rootRef.current?.contains(e.target as Node)) return;
      dismiss();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    container.addEventListener("scroll", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [containerRef, dismiss, startTranslate]);

  if (!pick) return null;

  // 浮窗定位:贴选区末尾,横向夹在视口内,纵向往下一点。
  const left = Math.min(
    Math.max(8, pick.anchor.left),
    window.innerWidth - CARD_WIDTH - 8,
  );
  const top = pick.anchor.top + 6;

  return (
    <div ref={rootRef} className="fixed z-50" style={{ left, top }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-accent"
        >
          <LanguagesIcon size={14} />
          <span>解析</span>
        </button>
      ) : (
        <div
          className="animate-in rounded-xl border bg-card p-3 shadow-lg fade-in-0 zoom-in-95 duration-150"
          style={{ width: CARD_WIDTH }}
        >
          {error ? (
            <span
              className="text-sm leading-snug text-destructive"
              role="alert"
            >
              {error}
            </span>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto text-sm leading-normal text-foreground">
              {result ? (
                <Markdown>{result}</Markdown>
              ) : (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Spinner /> 解析中…
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
