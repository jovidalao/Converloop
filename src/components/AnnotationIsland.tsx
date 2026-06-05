import { BookPlusIcon, LanguagesIcon, Volume2Icon, XIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import {
  addSelectionToLearningData,
  translateSelection,
} from "../orchestrator";
import { isAgentHidden } from "../runtime";
import { playSpeech, stopSpeech } from "../tts/playback";
import { speakText } from "../tts/speak";
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

type View = "actions" | "analysis";
type Busy = "analysis" | "speak" | "save";
type Status = { tone: "success" | "error"; text: string };

const ISLAND_WIDTH = 320;

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// 从当前选区取出:选中文字 + 所在「可解析块」整段文本 + 末尾视口坐标。
// 选区必须落在 container 内、且祖先带 data-selectable-context(消息正文)才算数。
// 只快照字符串,不持有 Range —— 动作都基于快照,无需回写 DOM 选区。
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

function clampPosition(anchor: Anchor, width: number) {
  const left = Math.min(
    Math.max(8, anchor.left),
    Math.max(8, window.innerWidth - width - 8),
  );
  const top = Math.min(Math.max(8, anchor.top + 8), window.innerHeight - 88);
  return { left, top };
}

function IslandButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 select-none items-center gap-1.5 rounded-md px-2.5 text-ui-caption font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-primary/10 text-primary"
          : "text-ui-muted hover:bg-accent hover:text-foreground active:bg-foreground-10",
      )}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

// 划词浮动岛:在消息区选中词/句 → 浮出学习动作(解析 / 朗读 / 加入)。
// 不暴露模型内部,只给可观察动作。挂在 ChatView 消息滚动区上,portal 到 body。
export function AnnotationIsland({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [view, setView] = useState<View>("actions");
  const [result, setResult] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0); // 作废在途的流式解析

  const dismiss = useCallback(() => {
    setPick(null);
    setView("actions");
    setResult("");
    setAnalysisError(null);
    setStatus(null);
    setBusy(null);
    genRef.current++;
    // 清掉残留高亮,否则点空白处虽 mousedown 已关闭,紧跟的 mouseup 又会把它当成
    // 有效选区重开浮岛(需点两次)。但只清「消息区内」的选区 —— 绝不碰输入框等容器
    // 外的选区/光标,否则会破坏 textarea 的输入与划选。
    const sel = window.getSelection();
    const container = containerRef.current;
    const anchor = sel?.rangeCount
      ? sel.getRangeAt(0).commonAncestorContainer
      : null;
    if (sel && anchor && container?.contains(anchor)) {
      sel.removeAllRanges();
    }
  }, [containerRef]);

  const startAnalysis = useCallback(async () => {
    if (!pick) return;
    const gen = ++genRef.current;
    setView("analysis");
    setResult("");
    setAnalysisError(null);
    setStatus(null);
    setBusy("analysis");
    let acc = "";
    try {
      const text = await translateSelection(
        pick.selection,
        pick.context,
        (d) => {
          if (genRef.current !== gen) return;
          acc += d;
          setResult(acc);
        },
      );
      if (genRef.current === gen) setResult(text);
    } catch (e) {
      if (genRef.current === gen) setAnalysisError(errText(e));
    } finally {
      if (genRef.current === gen) setBusy(null);
    }
  }, [pick]);

  async function speakSelection() {
    if (!pick || busy) return;
    setStatus(null);
    setBusy("speak");
    try {
      stopSpeech();
      const audio = await speakText(pick.selection);
      await playSpeech(audio, pick.selection);
      setStatus({ tone: "success", text: "正在朗读选中文本" });
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function addToLearningData() {
    if (!pick || busy) return;
    setStatus(null);
    if (!pick.selection.trim()) {
      setStatus({ tone: "error", text: "请选择包含文字或数字的内容" });
      return;
    }
    setBusy("save");
    try {
      const item = await addSelectionToLearningData(
        pick.selection,
        pick.context,
      );
      setStatus({ tone: "success", text: `已加入学习数据:${item.label}` });
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 选区结束:浮岛外的 mouseup 才重算选区。有有效新选区→以 actions 视图打开。
    function onMouseUp(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      const next = container ? readPick(container) : null;
      if (!next) {
        dismiss();
        return;
      }
      setPick(next);
      setView("actions");
      setResult("");
      setAnalysisError(null);
      setStatus(null);
      setBusy(null);
      genRef.current++;
    }

    // 浮岛外的 mousedown 立即关闭(含开始新一次选择)。岛内点击交给按钮处理。
    function onMouseDown(e: MouseEvent) {
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
  }, [containerRef, dismiss]);

  if (!pick) return null;

  const position = clampPosition(pick.anchor, ISLAND_WIDTH);

  // position: fixed 坐标取自 getClientRects() 的视口坐标。portal 到 body 让 fixed
  // 相对视口定位 —— 否则祖先 .codex-main 的 backdrop-filter 会建立包含块,使浮岛偏移。
  // 不做入场动画:opacity 渐入期间 WebKit 会临时停用 backdrop-filter,毛玻璃在深色
  // 模式下会「先深后浅」闪一下;直接出现,材质从首帧即稳定。
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="选区学习动作"
      className="fixed z-[400]"
      style={{ left: position.left, top: position.top, width: ISLAND_WIDTH }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* 半透明毛玻璃材质 + 柔和投影,贴近 macOS NSPopover 观感 */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-popover/85 shadow-modal-small backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-popover/75">
        <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1.5">
          {!isAgentHidden("builtin:transformer:translate") && (
            <IslandButton
              icon={<LanguagesIcon size={14} />}
              label="解析"
              active={view === "analysis"}
              disabled={busy !== null && busy !== "analysis"}
              onClick={() => void startAnalysis()}
            />
          )}
          <IslandButton
            icon={
              busy === "speak" ? (
                <Spinner className="size-3" />
              ) : (
                <Volume2Icon size={14} />
              )
            }
            label="朗读"
            disabled={busy !== null && busy !== "speak"}
            onClick={() => void speakSelection()}
          />
          <IslandButton
            icon={
              busy === "save" ? (
                <Spinner className="size-3" />
              ) : (
                <BookPlusIcon size={14} />
              )
            }
            label="加入"
            disabled={busy !== null && busy !== "save"}
            onClick={() => void addToLearningData()}
          />
          <button
            type="button"
            className="ml-auto inline-flex size-7 select-none items-center justify-center rounded-md text-ui-muted transition-colors hover:bg-accent hover:text-foreground active:bg-foreground-10 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
            aria-label="关闭"
            onMouseDown={(e) => e.preventDefault()}
            onClick={dismiss}
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="px-3 py-2.5">
          <div className="select-none truncate text-ui-caption font-medium text-ui-muted">
            {pick.selection}
          </div>
          {view === "analysis" && (
            <div className="mt-2 max-h-[50vh] overflow-y-auto text-ui-body leading-relaxed text-foreground">
              {analysisError ? (
                <p className="m-0 text-destructive-text" role="alert">
                  {analysisError}
                </p>
              ) : result ? (
                <Markdown>{result}</Markdown>
              ) : (
                <span className="inline-flex items-center gap-2 text-ui-muted">
                  <Spinner className="size-3.5" />
                  解析中…
                </span>
              )}
            </div>
          )}
          {status && (
            <p
              className={cn(
                "mt-2 mb-0 text-ui-caption",
                status.tone === "success"
                  ? "text-success-text"
                  : "text-destructive-text",
              )}
              role={status.tone === "error" ? "alert" : undefined}
            >
              {status.text}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
