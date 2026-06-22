import {
  CheckIcon,
  ClipboardCopyIcon,
  SaveIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { buildDrillAuthoringSpec } from "../drills/authoring-spec";
import { parseDrillDocument } from "../drills/format";
import type { DrillDefinition } from "../drills/types";
import { generateDrillDocumentFromDescription } from "../orchestrator";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";

// Create/edit a training mode as what it really is: one drill@1 Markdown document. The same surface
// covers all three creation paths — describe-to-AI (fills the textarea), paste from an external AI
// (the "copy authoring guide" button makes that round-trip easy), or hand-editing — with the
// importer's live validation underneath. Save is enabled only when the document parses.
export function DrillDocumentDialog({
  mode,
  initialMd = "",
  onSave,
  onCancel,
}: {
  mode: "create" | "edit";
  initialMd?: string;
  onSave: (sourceMd: string, def: DrillDefinition) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState(initialMd);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [specCopied, setSpecCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const parsed = useMemo(
    () => (doc.trim() ? parseDrillDocument(doc) : null),
    [doc],
  );

  async function copySpec() {
    await navigator.clipboard.writeText(buildDrillAuthoringSpec());
    setSpecCopied(true);
    window.setTimeout(() => setSpecCopied(false), 2500);
  }

  async function generate() {
    const request = description.trim();
    if (!request || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const { sourceMd, result } =
        await generateDrillDocumentFromDescription(request);
      setDoc(sourceMd);
      if (!result.ok) {
        setGenerateError(t("drillDialog.generateInvalid"));
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!parsed?.ok || saving) return;
    setSaving(true);
    try {
      await onSave(doc, parsed.def);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === "create"
          ? t("drillDialog.createTitle")
          : t("drillDialog.editTitle")
      }
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onCancel}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops propagation to the backdrop-close handler; not an interactive control */}
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border bg-card p-4 shadow-modal-small"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-ui-title font-semibold">
              {mode === "create"
                ? t("drillDialog.createTitle")
                : t("drillDialog.editTitle")}
            </h3>
            <div className="text-ui-caption text-ui-muted">
              {t("drillDialog.subtitle")}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCancel}
            aria-label={t("common.close")}
          >
            <XIcon size={16} />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto">
          {mode === "create" && (
            <>
              <div className="flex items-end gap-2">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("drillDialog.describePlaceholder")}
                  rows={2}
                  className="min-h-16 flex-1 resize-y"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={generating || !description.trim()}
                  onClick={() => void generate()}
                >
                  {generating ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <SparklesIcon size={15} />
                  )}
                  {t("drillDialog.generate")}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 text-ui-caption text-ui-muted">
                <span className="min-w-0">{t("drillDialog.externalHint")}</span>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-accent"
                  onClick={() => void copySpec()}
                >
                  {specCopied ? (
                    <CheckIcon size={13} />
                  ) : (
                    <ClipboardCopyIcon size={13} />
                  )}
                  {specCopied
                    ? t("drillDialog.specCopied")
                    : t("drillDialog.copySpec")}
                </button>
              </div>
              {generateError && (
                <p
                  className="m-0 text-ui-caption text-destructive"
                  role="alert"
                >
                  {generateError}
                </p>
              )}
            </>
          )}

          <Textarea
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            placeholder={t("drillDialog.documentPlaceholder")}
            spellCheck={false}
            className="min-h-72 resize-y font-mono text-ui-caption leading-relaxed"
          />

          {parsed && !parsed.ok && (
            <div
              className="rounded-md bg-destructive/10 px-3 py-2 text-ui-caption text-destructive"
              role="alert"
            >
              <div className="mb-1 font-medium">
                {t("drillDialog.errorsTitle")}
              </div>
              <ul className="m-0 list-disc pl-4">
                {parsed.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
              <div className="mt-1.5 text-destructive/80">
                {t("drillDialog.errorsHint")}
              </div>
            </div>
          )}
          {parsed?.ok && parsed.warnings.length > 0 && (
            <div className="rounded-md bg-warning/10 px-3 py-2 text-ui-caption text-warning">
              <ul className="m-0 list-disc pl-4">
                {parsed.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {parsed?.ok && (
            <div className="flex items-center gap-2 text-ui-caption text-ui-muted">
              <CheckIcon size={13} className="text-success" />
              {t("drillDialog.validSummary", {
                name: parsed.def.name,
                interaction: parsed.def.interaction,
              })}
            </div>
          )}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!parsed?.ok || saving}
          >
            {saving ? <Spinner className="size-3.5" /> : <SaveIcon size={15} />}
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
