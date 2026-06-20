import {
  BookOpenCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  HeadphonesIcon,
  ListMusicIcon,
  ListXIcon,
  MessageSquareIcon,
  TargetIcon,
  ZapIcon,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";
import { getAppPortalContainer } from "@/lib/portal-container";
import { cn } from "@/lib/utils";
import { type ConversationMeta, conversationType } from "../db/conversations";
import type { ListeningItem } from "../tts/listening";
import { Spinner } from "./ui/spinner";

// Same conversation-kind icon as the sidebar history rows, so a picker row is recognizable.
export function convIcon(c: ConversationMeta): ReactNode {
  switch (conversationType(c)) {
    case "learning_agent":
      return <BookOpenCheckIcon className="size-3.5 shrink-0" />;
    case "quickfire":
      return <ZapIcon className="size-3.5 shrink-0" />;
    case "dictation":
      return <HeadphonesIcon className="size-3.5 shrink-0" />;
    case "review_drill":
      return <TargetIcon className="size-3.5 shrink-0" />;
    default:
      return <MessageSquareIcon className="size-3.5 shrink-0" />;
  }
}

// Conversation selector as a popover. Its panel is portaled to the app shell and positioned with
// `fixed` against the trigger, so an enclosing `overflow-hidden` can't clip a long list and the panel
// height is capped to the viewport (it always scrolls instead of running off-screen). Toggling rows
// keeps it open; clicking outside or pressing Escape closes it. Shared by the listening player and the
// sentence-dictation view, which both select source conversations and show per-conversation line counts.
export function ConversationPickerPopover({
  conversations,
  selectedIds,
  itemsByConv,
  loadingIds,
  onToggle,
  onSelectAll,
  onClear,
}: {
  conversations: ConversationMeta[];
  selectedIds: string[];
  itemsByConv: Record<string, ListeningItem[]>;
  loadingIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Anchor the portaled panel to the live trigger position (and re-anchor on resize).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () =>
      setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    measure();
    function onDown(e: MouseEvent) {
      const node = e.target as Node;
      if (triggerRef.current?.contains(node)) return;
      if (panelRef.current?.contains(node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-ui-body transition-colors hover:bg-accent"
      >
        <ListMusicIcon className="size-4 text-ui-muted" />
        <span>{t("listening.selectConversations")}</span>
        <span
          className={cn(
            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-ui-caption font-medium tabular-nums",
            selectedIds.length > 0
              ? "bg-primary/10 text-primary"
              : "bg-muted text-ui-muted",
          )}
        >
          {selectedIds.length}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 text-ui-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            data-listening-overlay
            style={{
              position: "fixed",
              top: rect.bottom + 6,
              right: Math.max(8, window.innerWidth - rect.right),
              maxHeight: window.innerHeight - rect.bottom - 16,
            }}
            className="z-50 flex w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-minimal"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-ui-caption font-medium text-ui-muted">
                {t("listening.selectConversations")}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-ui-caption text-primary hover:bg-accent"
                  onClick={onSelectAll}
                >
                  {t("listening.selectAll")}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ui-caption text-ui-muted hover:bg-accent disabled:opacity-40"
                  onClick={onClear}
                  disabled={selectedIds.length === 0}
                >
                  <ListXIcon className="size-3" />
                  {t("listening.clear")}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="px-3 py-8 text-center text-ui-caption text-ui-muted">
                  {t("sidebar.noConversations")}
                </div>
              ) : (
                conversations.map((c) => {
                  const checked = selectedIds.includes(c.id);
                  const itemList = itemsByConv[c.id];
                  const loading = loadingIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onToggle(c.id)}
                      className="flex w-full items-center gap-2.5 border-b px-2.5 py-2 text-left text-ui-body last:border-0 hover:bg-accent/60"
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {checked && <CheckIcon className="size-3" />}
                      </span>
                      <span className="text-ui-muted">{convIcon(c)}</span>
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="shrink-0 text-ui-caption text-ui-muted">
                        {loading ? (
                          <Spinner className="size-3" />
                        ) : checked && itemList ? (
                          t("listening.sentenceCount", { n: itemList.length })
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          getAppPortalContainer() ?? document.body,
        )}
    </>
  );
}
