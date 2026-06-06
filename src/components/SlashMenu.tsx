import { useEffect, useRef } from "react";
import { useTranslation } from "@/i18n";
import type { SlashCommand } from "../commands";

interface SlashMenuProps {
  commands: SlashCommand[];
  selected: number;
  onHover: (index: number) => void;
  onActivate: (command: SlashCommand) => void;
}

// Chat-bar slash command menu: a floating list right above the input. Keyboard
// navigation (↑↓ / Enter / Tab / Esc) is intercepted by ChatView on the textarea
// (activedescendant pattern, focus stays in the input); this component only
// renders and handles the mouse.
export function SlashMenu({
  commands,
  selected,
  onHover,
  onActivate,
}: SlashMenuProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected row in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll into view whenever the selection changes; `selected` isn't referenced directly
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("slashMenu.ariaLabel")}
      className="absolute inset-x-0 bottom-full z-40 mb-1.5 max-h-[40vh] overflow-y-auto rounded-xl border bg-card py-1 shadow-minimal"
    >
      {commands.map((command, idx) => {
        const isSelected = idx === selected;
        return (
          // biome-ignore lint/a11y/useFocusableInteractive: options aren't individually focused; focus stays in the input
          <div
            key={command.name}
            role="option"
            aria-selected={isSelected}
            data-selected={isSelected}
            className="mx-1 flex items-baseline gap-2.5 rounded-md px-2.5 py-1.5 text-ui-body data-[selected=true]:bg-accent"
            onMouseMove={() => onHover(idx)}
            onMouseDown={(e) => {
              // Don't blur the input; activate on mousedown (common autocomplete pattern).
              e.preventDefault();
              onActivate(command);
            }}
          >
            <span className="shrink-0 font-medium text-foreground">
              /{command.name}
            </span>
            {command.argsHint && (
              <span className="shrink-0 text-ui-meta text-ui-subtle">
                {command.argsHint}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-right text-ui-caption text-ui-muted">
              {command.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}
