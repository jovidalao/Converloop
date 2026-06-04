import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useId,
} from "react";
import { cn } from "@/lib/utils";

// Craft-style EntityRow primitive: a single scannable list row shared by
// sessions / lessons / capabilities / projects. Slots — leading icon, title,
// inline status badges, trailing meta, hover-revealed actions — keep height,
// icon, badge and hover behaviour consistent across every list in the app.
// Reuses the existing `.codex-sidebar-row` chrome so the desktop look is
// preserved; the value is removing per-list row logic from call sites.

export interface EntityRowProps {
  /** Leading icon slot (14px / size-3.5 recommended). */
  icon?: ReactNode;
  /** Primary label — truncated, takes the remaining width. */
  title: ReactNode;
  /** Inline status badges shown right after the title (branch, lesson type…). */
  badges?: ReactNode;
  /** Trailing meta (relative time, count). Hidden on hover when actions exist. */
  meta?: ReactNode;
  /** Hover-revealed action buttons (compose with EntityRowAction). */
  actions?: ReactNode;
  active?: boolean;
  tooltip?: string;
  onSelect?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  onDoubleClick?: () => void;
  className?: string;
}

export function EntityRow({
  icon,
  title,
  badges,
  meta,
  actions,
  active,
  tooltip,
  onSelect,
  onContextMenu,
  onDoubleClick,
  className,
}: EntityRowProps) {
  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.();
    }
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: can't be a <button> — it nests action buttons; uses role+tabIndex+keyboard instead
    <div
      role="button"
      tabIndex={0}
      className={cn("codex-sidebar-row group", className)}
      data-active={active || undefined}
      title={tooltip}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {icon != null && (
        <span className="codex-sidebar-leading-icon">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {badges}
      {meta != null && (
        <span
          className={cn(
            "codex-row-meta",
            actions != null && "group-hover:hidden",
          )}
        >
          {meta}
        </span>
      )}
      {actions != null && <span className="codex-row-actions">{actions}</span>}
    </div>
  );
}

// A single hover-revealed action button inside an EntityRow's actions slot.
export function EntityRowAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: (e: ReactMouseEvent) => void;
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

// A collapsible list group: heading (icon + label + chevron) over an animated
// body. `pinned` renders above the collapsible region and stays visible while
// collapsed (e.g. a peek of the first item). Body height/opacity animate.
export function EntitySection({
  icon,
  label,
  collapsed,
  onToggle,
  pinned,
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  pinned?: ReactNode;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="codex-sidebar-learning">
      <button
        type="button"
        className="codex-section-heading"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        {icon != null && (
          <span className="codex-sidebar-leading-icon">{icon}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        )}
      </button>
      <div className="codex-sidebar-list">
        {pinned}
        <div
          id={bodyId}
          className="codex-collapsible"
          data-collapsed={collapsed || undefined}
        >
          <div className="codex-collapsible-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}
