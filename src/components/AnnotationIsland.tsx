import { BookPlusIcon, LanguagesIcon, Volume2Icon, XIcon } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  createSelectionLearningItem,
  previewSelectionLearningItem,
  type SelectionLearningItemPreview,
  translateSelection,
} from "../orchestrator";
import { isAgentHidden } from "../runtime";
import { playSpeech, stopSpeech } from "../tts/playback";
import { speakText } from "../tts/speak";
import { Markdown } from "./Markdown";
import { Spinner } from "./ui/spinner";

interface Anchor {
  left: number; // viewport coordinates: end of the selection
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

// Pull from the current selection: the selected text + the full text of its
// enclosing "parseable block" + the end's viewport coordinates. The selection
// only counts if it falls inside `container` and has an ancestor with
// data-selectable-context (message body). Snapshots strings only, never holds a
// Range — every action works off the snapshot, no need to write back the DOM
// selection.
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

// Selection floating island: select a word/sentence in the message area → a set
// of learning actions floats up (analyze / read aloud / add). Exposes no model
// internals, only observable actions. Mounts on ChatView's message scroll area
// and portals to body.
export function AnnotationIsland({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const [pick, setPick] = useState<Pick | null>(null);
  const [view, setView] = useState<View>("actions");
  const [result, setResult] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [learningPreview, setLearningPreview] =
    useState<SelectionLearningItemPreview | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0); // invalidate in-flight streaming analysis

  const dismiss = useCallback(() => {
    setPick(null);
    setView("actions");
    setResult("");
    setAnalysisError(null);
    setStatus(null);
    setLearningPreview(null);
    setBusy(null);
    genRef.current++;
    // Clear leftover highlights, otherwise clicking blank space (mousedown
    // already closed it) lets the following mouseup treat it as a valid
    // selection and reopen the island (requiring two clicks). But only clear
    // selections "inside the message area" — never touch selections/cursors
    // outside the container such as the input, or it breaks textarea typing and
    // selection.
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
      setStatus({ tone: "success", text: t("annotationIsland.speaking") });
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function addToLearningData() {
    if (!pick || busy) return;
    setStatus(null);
    setLearningPreview(null);
    if (!pick.selection.trim()) {
      setStatus({ tone: "error", text: t("annotationIsland.selectTextHint") });
      return;
    }
    setBusy("save");
    try {
      const item = await previewSelectionLearningItem(
        pick.selection,
        pick.context,
      );
      setLearningPreview(item);
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function confirmLearningPreview() {
    if (!learningPreview || busy) return;
    setStatus(null);
    setBusy("save");
    try {
      const item = await createSelectionLearningItem(learningPreview);
      setLearningPreview(null);
      setStatus({
        tone: "success",
        text: t("annotationIsland.added", { label: item.label }),
      });
    } catch (e) {
      setStatus({ tone: "error", text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Selection ends: only a mouseup outside the island recomputes the
    // selection. A valid new selection → open in the actions view.
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
      setLearningPreview(null);
      setBusy(null);
      genRef.current++;
    }

    // A mousedown outside the island closes it immediately (including starting a
    // new selection). Clicks inside are handled by the buttons.
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

  // position: fixed coordinates come from getClientRects()'s viewport coords.
  // Portaling to body makes the fixed positioning relative to the viewport —
  // otherwise the ancestor .codex-main's backdrop-filter establishes a
  // containing block and offsets the island. No entrance animation: during an
  // opacity fade-in WebKit temporarily disables backdrop-filter, so the frosted
  // glass would flash "dark then light" in dark mode; appearing instantly keeps
  // the material stable from the first frame.
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("annotationIsland.ariaLabel")}
      className="fixed z-[400]"
      style={{ left: position.left, top: position.top, width: ISLAND_WIDTH }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Semi-transparent frosted-glass material + soft shadow, close to the
          macOS NSPopover look */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-popover/85 shadow-modal-small backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-popover/75">
        <div className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1.5">
          {!isAgentHidden("builtin:transformer:translate") && (
            <IslandButton
              icon={<LanguagesIcon size={14} />}
              label={t("annotationIsland.analyze")}
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
            label={t("annotationIsland.speak")}
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
            label={t("annotationIsland.add")}
            disabled={busy !== null && busy !== "save"}
            onClick={() => void addToLearningData()}
          />
          <button
            type="button"
            className="ml-auto inline-flex size-7 select-none items-center justify-center rounded-md text-ui-muted transition-colors hover:bg-accent hover:text-foreground active:bg-foreground-10 focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
            aria-label={t("common.close")}
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
                  {t("annotationIsland.analyzing")}
                </span>
              )}
            </div>
          )}
          {learningPreview && (
            <div className="mt-2 rounded-md border bg-background px-2.5 py-2 text-ui-caption leading-snug">
              <div className="font-medium text-foreground">
                {t("annotationIsland.previewTitle")}
              </div>
              <div className="mt-1 text-foreground">
                {learningPreview.label}
                <span className="ml-1 text-ui-muted">
                  ({learningPreview.type})
                </span>
              </div>
              <div className="mt-1 font-mono text-ui-muted">
                {learningPreview.key}
              </div>
              {learningPreview.example && (
                <div className="mt-1 text-ui-muted">
                  {learningPreview.example}
                </div>
              )}
              {learningPreview.notes && (
                <div className="mt-1 text-ui-muted">
                  {learningPreview.notes}
                </div>
              )}
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-ui-caption text-ui-muted hover:bg-accent hover:text-foreground"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setLearningPreview(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary px-2 py-1 text-ui-caption font-medium text-primary-foreground disabled:opacity-50"
                  disabled={busy === "save"}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void confirmLearningPreview()}
                >
                  {busy === "save"
                    ? t("annotationIsland.saving")
                    : t("annotationIsland.confirmAdd")}
                </button>
              </div>
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
