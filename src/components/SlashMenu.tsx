import { Settings2Icon } from "lucide-react";
import { useEffect, useRef } from "react";
import { type TFunction, useTranslation } from "@/i18n";
import type { SlashCommand } from "../commands";

interface SlashMenuProps {
  commands: SlashCommand[];
  selected: number;
  onHover: (index: number) => void;
  onActivate: (command: SlashCommand) => void;
  /** When set, a "Customize commands…" footer row opens the slash-command settings. */
  onCustomize?: () => void;
}

// Menu text resolution: built-ins show their localized i18n text; once the user overrides a field
// (or the command is their own), the stored text is shown verbatim.
function commandDescription(command: SlashCommand, t: TFunction): string {
  return command.descriptionKey
    ? t(command.descriptionKey)
    : command.description;
}

function commandArgsHint(
  command: SlashCommand,
  t: TFunction,
): string | undefined {
  if (!command.argsHint) return undefined;
  return command.argsHintKey ? t(command.argsHintKey) : command.argsHint;
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
  onCustomize,
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
    <div className="absolute inset-x-0 bottom-full z-40 mb-1.5 overflow-hidden rounded-xl border bg-card shadow-minimal">
      <div
        ref={listRef}
        role="listbox"
        aria-label={t("slashMenu.ariaLabel")}
        className="max-h-[40vh] overflow-y-auto py-1"
      >
        {commands.map((command, idx) => {
          const isSelected = idx === selected;
          const argsHint = commandArgsHint(command, t);
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
              {command.source && (
                <span className="shrink-0 rounded border border-border/70 px-1 text-[10px] leading-4 text-ui-muted">
                  {t(
                    command.source === "custom"
                      ? "slashMenu.customBadge"
                      : "slashMenu.editedBadge",
                  )}
                </span>
              )}
              {argsHint && (
                <span className="shrink-0 text-ui-meta text-ui-subtle">
                  {argsHint}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-right text-ui-caption text-ui-muted">
                {commandDescription(command, t)}
              </span>
            </div>
          );
        })}
      </div>
      {onCustomize && (
        <button
          type="button"
          tabIndex={-1}
          className="flex w-full items-center gap-1.5 border-t border-border/70 px-3.5 py-1.5 text-left text-ui-caption text-ui-muted hover:bg-accent hover:text-foreground"
          onMouseDown={(e) => {
            e.preventDefault();
            onCustomize();
          }}
        >
          <Settings2Icon className="size-3.5" />
          {t("slashMenu.customize")}
        </button>
      )}
    </div>
  );
}

interface SlashBodyHintProps {
  command: SlashCommand;
  /** Whether the user has typed any body text yet; while empty, requires-args commands show a nudge. */
  hasBody: boolean;
}

// Passive one-line bar in the menu's position once a known input-taking command enters body mode
// ("/topic ..."): keeps the command's hint and description visible while the arguments are typed,
// and explains why Enter does nothing while a required body is still empty.
export function SlashBodyHint({ command, hasBody }: SlashBodyHintProps) {
  const { t } = useTranslation();
  const argsHint = commandArgsHint(command, t);
  return (
    <div className="absolute inset-x-0 bottom-full z-40 mb-1.5 flex items-baseline gap-2.5 rounded-xl border bg-card px-3.5 py-1.5 text-ui-body shadow-minimal">
      <span className="shrink-0 font-medium text-foreground">
        /{command.name}
      </span>
      {argsHint && (
        <span className="shrink-0 text-ui-meta text-ui-subtle">{argsHint}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-right text-ui-caption text-ui-muted">
        {!hasBody ? t("slashMenu.bodyMissing") : commandDescription(command, t)}
      </span>
    </div>
  );
}
