import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  type AppActionId,
  actionKeyCaps,
  bindingHasModifier,
  EDITABLE_ACTIONS,
  findBindingConflict,
  hasKeybindingOverride,
  type KeyBinding,
  resetAllKeybindings,
  resetKeybinding,
  setKeybinding,
  useKeybindings,
} from "@/lib/app-actions";
import { isMacOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-border/70 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted shadow-minimal-flat">
      {children}
    </kbd>
  );
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "OS"]);

export function ShortcutsEditor() {
  const { t } = useTranslation();
  // Re-render when any chord changes (custom override or reset).
  useKeybindings();
  const [recordingId, setRecordingId] = useState<AppActionId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While recording, capture the next chord. The capture-phase listener runs
  // before the app's global keydown handler, so app shortcuts don't fire.
  useEffect(() => {
    if (!recordingId) return;
    const id = recordingId;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_KEYS.has(e.key)) return; // wait for the real key
      if (
        e.key === "Escape" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        setRecordingId(null);
        setError(null);
        return;
      }
      // Store the primary modifier as `meta` on every platform (⌘ on macOS,
      // Ctrl on Windows/Linux) so it round-trips with the defaults. Literal
      // `ctrl` is kept only on macOS, where Control is a distinct modifier.
      const mac = isMacOS();
      const binding: KeyBinding = {
        key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
        meta: (mac ? e.metaKey : e.ctrlKey) || undefined,
        ctrl: (mac && e.ctrlKey) || undefined,
        shift: e.shiftKey || undefined,
        alt: e.altKey || undefined,
      };
      if (!bindingHasModifier(binding)) {
        setError(t("settings.shortcuts.needModifier"));
        return;
      }
      const conflict = findBindingConflict(binding, id);
      if (conflict) {
        setError(
          t("settings.shortcuts.conflict", {
            action: t(`actions.${conflict}`),
          }),
        );
        return;
      }
      setKeybinding(id, binding);
      setRecordingId(null);
      setError(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId, t]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-ui-meta font-medium text-ui-muted">
            {t("settings.shortcuts.title")}
          </span>
          <p className="mt-1 mb-0 text-ui-caption leading-snug text-ui-muted">
            {t("settings.shortcuts.description")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            resetAllKeybindings();
            setRecordingId(null);
            setError(null);
          }}
        >
          {t("settings.shortcuts.resetAll")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/75 shadow-minimal-flat">
        {EDITABLE_ACTIONS.map((action, i) => {
          const recording = recordingId === action.id;
          const keys = actionKeyCaps(action.id);
          return (
            <div
              key={action.id}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 text-ui-body",
                i > 0 && "border-t border-border/60",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {t(`actions.${action.id}`)}
              </span>
              {recording ? (
                <span className="text-ui-caption text-primary">
                  {t("settings.shortcuts.recording")}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  {keys.length > 0 ? (
                    keys.map((cap) => <KeyCap key={cap}>{cap}</KeyCap>)
                  ) : (
                    <span className="text-ui-caption text-ui-muted">
                      {t("settings.shortcuts.unassigned")}
                    </span>
                  )}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant={recording ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setRecordingId((cur) =>
                      cur === action.id ? null : action.id,
                    );
                  }}
                >
                  {recording
                    ? t("common.cancel")
                    : t("settings.shortcuts.edit")}
                </Button>
                {hasKeybindingOverride(action.id) && !recording && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resetKeybinding(action.id)}
                  >
                    {t("settings.shortcuts.reset")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="m-0 text-ui-caption text-destructive">{error}</p>}
    </div>
  );
}
