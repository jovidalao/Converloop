import { BookPlusIcon, LanguagesIcon, Volume2Icon, XIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { createManualMasteryItem } from "../db/mastery";
import { MissingApiKeyError, translateSelection } from "../orchestrator";
import { playSpeech, stopSpeech } from "../tts/playback";
import { MissingTtsApiKeyError, speakText } from "../tts/speak";
import { Markdown } from "./Markdown";
import { Spinner } from "./ui/spinner";

interface Anchor {
  left: number;
  top: number;
}

interface Pick {
  selection: string;
  context: string;
  anchor: Anchor;
  range: Range;
}

type IslandMode = "menu" | "analysis";

const CARD_WIDTH = 360;
const MENU_WIDTH = 292;

function textKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_:-]/gu, "")
    .slice(0, 80);
}

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
    range: range.cloneRange(),
  };
}

function restoreSelection(range: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
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
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-ui-caption font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-ui-muted hover:bg-accent hover:text-foreground",
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

// Craft-style annotation island: select text in a message, then choose a
// learning action without losing the selection. It deliberately shows observable
// actions (analysis / read aloud / add to learning data), not model internals.
export function AnnotationIsland({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useState<IslandMode>("menu");
  const [result, setResult] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"analysis" | "speak" | "save" | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);

  const dismiss = useCallback(() => {
    setPick(null);
    setMode("menu");
    setResult("");
    setMessage(null);
    setError(null);
    setLoading(null);
    genRef.current++;
  }, []);

  const startAnalysis = useCallback(async () => {
    if (!pick) return;
    restoreSelection(pick.range);
    const gen = ++genRef.current;
    setMode("analysis");
    setResult("");
    setMessage(null);
    setError(null);
    setLoading("analysis");
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
      if (genRef.current !== gen) return;
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      if (genRef.current === gen) setLoading(null);
    }
  }, [pick]);

  async function speakSelection() {
    if (!pick || loading) return;
    restoreSelection(pick.range);
    setMessage(null);
    setError(null);
    setLoading("speak");
    try {
      stopSpeech();
      const audio = await speakText(pick.selection);
      await playSpeech(audio, pick.selection);
      setMessage("正在朗读选中文本。");
    } catch (e) {
      setError(
        e instanceof MissingTtsApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoading(null);
    }
  }

  async function addToLearningData() {
    if (!pick || loading) return;
    restoreSelection(pick.range);
    setMessage(null);
    setError(null);
    setLoading("save");
    try {
      const label = pick.selection.trim();
      const key = textKey(label);
      if (!key) {
        setError("请选择包含文字或数字的内容。");
        return;
      }
      await createManualMasteryItem({
        key: `vocab:${key}`,
        label,
        type: "vocab",
        status: "learning",
        example: pick.context,
        notes: label,
      });
      setMessage("已加入学习数据。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onMouseUp(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      const next = container ? readPick(container) : null;
      if (!next) {
        dismiss();
        return;
      }
      setPick(next);
      setMode("menu");
      setResult("");
      setMessage(null);
      setError(null);
      setLoading(null);
    }

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

  const width = mode === "analysis" ? CARD_WIDTH : MENU_WIDTH;
  const position = clampPosition(pick.anchor, width);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="选区学习动作"
      className="fixed z-50 animate-in fade-in-0 zoom-in-95 duration-150"
      style={{ left: position.left, top: position.top, width }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="overflow-hidden rounded-xl border bg-card shadow-modal-small">
        <div className="flex items-center gap-1 border-b px-1.5 py-1.5">
          <IslandButton
            icon={
              loading === "analysis" ? (
                <Spinner className="size-3" />
              ) : (
                <LanguagesIcon size={14} />
              )
            }
            label="解析"
            active={mode === "analysis"}
            disabled={loading !== null && loading !== "analysis"}
            onClick={() => void startAnalysis()}
          />
          <IslandButton
            icon={
              loading === "speak" ? (
                <Spinner className="size-3" />
              ) : (
                <Volume2Icon size={14} />
              )
            }
            label="朗读"
            disabled={loading !== null && loading !== "speak"}
            onClick={() => void speakSelection()}
          />
          <IslandButton
            icon={
              loading === "save" ? (
                <Spinner className="size-3" />
              ) : (
                <BookPlusIcon size={14} />
              )
            }
            label="加入"
            disabled={loading !== null && loading !== "save"}
            onClick={() => void addToLearningData()}
          />
          <button
            type="button"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-ui-muted transition-colors hover:bg-accent hover:text-foreground"
            aria-label="关闭"
            onClick={dismiss}
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="px-3 py-2">
          <div className="mb-1 truncate text-ui-caption font-medium text-ui-muted">
            {pick.selection}
          </div>
          {mode === "analysis" && (
            <div className="max-h-[50vh] overflow-y-auto text-ui-body leading-relaxed text-foreground">
              {error ? (
                <p className="m-0 text-destructive" role="alert">
                  {error}
                </p>
              ) : result ? (
                <Markdown>{result}</Markdown>
              ) : (
                <span className="inline-flex items-center gap-2 text-ui-muted">
                  <Spinner />
                  正在解析…
                </span>
              )}
            </div>
          )}
          {mode === "menu" && (
            <p className="m-0 text-ui-caption leading-snug text-ui-muted">
              选择一个学习动作。浮岛关闭前会保留当前选区。
            </p>
          )}
          {message && (
            <p className="mt-2 mb-0 text-ui-caption text-success">{message}</p>
          )}
          {mode !== "analysis" && error && (
            <p
              className="mt-2 mb-0 text-ui-caption text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
