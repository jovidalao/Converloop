import { CircleAlertIcon, XIcon } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { getAppPortalContainer } from "@/lib/portal-container";
import { cn } from "@/lib/utils";

type Align = "start" | "center" | "end";
type Side = "top" | "bottom";

type Position = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

const DEFAULT_MARGIN = 8;
const MIN_AVAILABLE_HEIGHT = 80;
const FLIP_THRESHOLD = 140;
const RADIX_PORTAL_SELECTORS = [
  "[data-radix-popper-content-wrapper]",
  "[role='listbox']",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isElement(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

export function AnchoredPopover({
  open,
  anchorRef,
  onClose,
  children,
  className,
  role,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  width = 320,
  viewportMargin = DEFAULT_MARGIN,
  listeningOverlay = false,
  ignoreOutsideSelectors = RADIX_PORTAL_SELECTORS,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  role?: string;
  align?: Align;
  side?: Side;
  sideOffset?: number;
  width?: number;
  viewportMargin?: number;
  listeningOverlay?: boolean;
  ignoreOutsideSelectors?: string[];
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    let frame = 0;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setPosition(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = Math.min(width, viewportWidth - viewportMargin * 2);
      const panelHeight = panelRef.current?.offsetHeight ?? 0;
      const below = viewportHeight - rect.bottom - sideOffset - viewportMargin;
      const above = rect.top - sideOffset - viewportMargin;
      const preferredSpace = side === "bottom" ? below : above;
      const alternateSpace = side === "bottom" ? above : below;
      const shouldFlip =
        preferredSpace <
          Math.min(panelHeight || FLIP_THRESHOLD, FLIP_THRESHOLD) &&
        alternateSpace > preferredSpace;
      const actualSide: Side = shouldFlip
        ? side === "bottom"
          ? "top"
          : "bottom"
        : side;
      const available =
        actualSide === "bottom"
          ? viewportHeight - rect.bottom - sideOffset - viewportMargin
          : rect.top - sideOffset - viewportMargin;
      const maxHeight = Math.max(MIN_AVAILABLE_HEIGHT, available);
      const measuredHeight = Math.min(panelHeight, maxHeight);
      const top =
        actualSide === "bottom"
          ? rect.bottom + sideOffset
          : rect.top - sideOffset - measuredHeight;
      const rawLeft =
        align === "start"
          ? rect.left
          : align === "center"
            ? rect.left + rect.width / 2 - panelWidth / 2
            : rect.right - panelWidth;
      const maxLeft = viewportWidth - panelWidth - viewportMargin;

      setPosition({
        left: clamp(rawLeft, viewportMargin, Math.max(viewportMargin, maxLeft)),
        top: clamp(
          top,
          viewportMargin,
          Math.max(
            viewportMargin,
            viewportHeight - measuredHeight - viewportMargin,
          ),
        ),
        width: panelWidth,
        maxHeight,
      });
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (panelRef.current) observer?.observe(panelRef.current);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      observer?.disconnect();
    };
  }, [open, anchorRef, align, side, sideOffset, width, viewportMargin]);

  useEffect(() => {
    if (!open || !onClose) return;

    const close = onClose;

    function onPointerDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      if (
        isElement(target) &&
        ignoreOutsideSelectors.some((selector) => target.closest(selector))
      )
        return;
      close();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef, ignoreOutsideSelectors]);

  if (!open) return null;

  const style: CSSProperties = position
    ? {
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
        zIndex: "var(--z-tooltip)",
      }
    : {
        left: viewportMargin,
        top: viewportMargin,
        width: Math.min(width, window.innerWidth - viewportMargin * 2),
        visibility: "hidden",
        zIndex: "var(--z-tooltip)",
      };

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      data-listening-overlay={listeningOverlay ? "" : undefined}
      className={cn(
        "fixed animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      style={style}
    >
      {children}
    </div>,
    getAppPortalContainer() ?? document.body,
  );
}

export function AnchoredErrorPopover({
  anchorRef,
  message,
  onClose,
  closeLabel,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  message: string | null;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <AnchoredPopover
      open={Boolean(message)}
      anchorRef={anchorRef}
      onClose={onClose}
      role="alert"
      width={320}
      className="flex items-start gap-2 overflow-hidden rounded-xl border border-destructive/25 bg-popover/95 p-2.5 text-left text-ui-caption text-popover-foreground shadow-modal-small backdrop-blur-xl"
    >
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 leading-snug text-destructive">
        {message}
      </span>
      <button
        type="button"
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-ui-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
        onClick={onClose}
        aria-label={closeLabel}
      >
        <XIcon size={13} />
      </button>
    </AnchoredPopover>
  );
}
