import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type InertSnapshot = {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
};

function visibleFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute("disabled"))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function useModalFocus({
  open,
  dialogRef,
  initialFocusRef,
  onClose,
}: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const currentDialog = dialog;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const overlay = currentDialog.closest<HTMLElement>("[data-modal-overlay]");
    const inerted: InertSnapshot[] = [];
    if (overlay?.parentElement) {
      for (const child of Array.from(overlay.parentElement.children)) {
        if (child === overlay || !(child instanceof HTMLElement)) continue;
        inerted.push({
          element: child,
          inert: child.inert,
          ariaHidden: child.getAttribute("aria-hidden"),
        });
        child.inert = true;
        child.setAttribute("aria-hidden", "true");
      }
    }

    const focusInitial = () => {
      const target =
        initialFocusRef?.current ??
        visibleFocusable(currentDialog)[0] ??
        currentDialog;
      target.focus();
    };
    const frame = window.requestAnimationFrame(focusInitial);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = visibleFocusable(currentDialog);
      if (focusable.length === 0) {
        e.preventDefault();
        currentDialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      for (const snapshot of inerted) {
        snapshot.element.inert = snapshot.inert;
        if (snapshot.ariaHidden === null) {
          snapshot.element.removeAttribute("aria-hidden");
        } else {
          snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
        }
      }
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
      previousFocusRef.current = null;
    };
  }, [open, dialogRef, initialFocusRef, onClose]);
}
