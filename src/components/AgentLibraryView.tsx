import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronDownIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "@/i18n";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  defaultAgentOutputSchema,
  exportAgentPackage,
  importAgentPackage,
  reviewAgentPackage,
} from "../agent-package";
import {
  createLearningAgent,
  DATA_SCOPE_LABELS,
  deleteLearningAgent,
  getLearningAgent,
  LEARNING_DATA_SCOPES,
  type LearningAgentKind,
  type LearningAgentMeta,
  type LearningAgentOutputMode,
  type LearningAgentWritebackPolicy,
  type LearningDataScope,
  type RuntimeAgentHook,
  type TransformerStage,
  updateLearningAgent,
} from "../db/learning-agents";
import { WEBSITE_DESIGN_URL } from "../lib/links";
import {
  type AgentCatalogEntry,
  type AgentEntry,
  BUILTIN_ACTION_DEFAULTS,
  clearBuiltinAgentOverride,
  getBuiltinAgentOverride,
  hideAgent,
  listAgentCatalog,
  reloadCustomRuntimeAgents,
  setAgentEnabled,
  setBuiltinAgentOverride,
} from "../runtime";
import { useConfirm } from "./confirm";
import {
  DEFAULT_REPLY_TRANSFORMER_ICON,
  REPLY_TRANSFORMER_ICON_NAMES,
  replyTransformerIcon,
} from "./reply-transformer-icons";
import type { MainView } from "./Sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

// Capability library: a grouped list of every registered capability (built-in + custom),
// organized by entry point (where/when it triggers). Create / edit / fine-tune happen in a
// modal so the list stays scannable for quick add/edit/delete.

const ENTRY_ORDER: AgentEntry[] = [
  "auto_turn",
  "selection",
  "reply_action",
  "message_action",
  "derive",
  "lesson",
];

function scopeName(scope: LearningDataScope, t: TFunction): string {
  return t(`scopeLabel.${scope}.name` as Parameters<TFunction>[0]);
}

function hookForKind(kind: LearningAgentKind): RuntimeAgentHook | null {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  return null;
}

function entryOf(entry: AgentCatalogEntry): AgentEntry {
  return entry.card?.entry ?? "auto_turn";
}

// Built-in capability cards are registered with English title/description in runtime/builtins.ts.
// Map each id to its i18n keys so the library shows localized name + description (custom agents keep
// the user's own name/description; a user label/description override, if any, also wins over i18n).
type MessageKey = Parameters<TFunction>[0];
const BUILTIN_CARD_I18N: Record<
  string,
  { title: MessageKey; desc: MessageKey }
> = {
  "builtin:conversation": {
    title: "agentLibrary.builtinCards.conversation.title",
    desc: "agentLibrary.builtinCards.conversation.desc",
  },
  "builtin:learning": {
    title: "agentLibrary.builtinCards.lessonTeacher.title",
    desc: "agentLibrary.builtinCards.lessonTeacher.desc",
  },
  "builtin:tutor": {
    title: "agentLibrary.builtinCards.tutor.title",
    desc: "agentLibrary.builtinCards.tutor.desc",
  },
  "builtin:drill_observer": {
    title: "agentLibrary.builtinCards.drillObserver.title",
    desc: "agentLibrary.builtinCards.drillObserver.desc",
  },
  "builtin:transformer:explain": {
    title: "agentLibrary.builtinCards.explain.title",
    desc: "agentLibrary.builtinCards.explain.desc",
  },
  "builtin:transformer:bilingual": {
    title: "agentLibrary.builtinCards.bilingual.title",
    desc: "agentLibrary.builtinCards.bilingual.desc",
  },
  "builtin:transformer:translate": {
    title: "agentLibrary.builtinCards.translate.title",
    desc: "agentLibrary.builtinCards.translate.desc",
  },
  "builtin:action:branch_from": {
    title: "agentLibrary.builtinCards.branchFrom.title",
    desc: "agentLibrary.builtinCards.branchFrom.desc",
  },
  "builtin:action:restart": {
    title: "agentLibrary.builtinCards.restart.title",
    desc: "agentLibrary.builtinCards.restart.desc",
  },
  "builtin:action:harder": {
    title: "agentLibrary.builtinCards.harder.title",
    desc: "agentLibrary.builtinCards.harder.desc",
  },
  "builtin:action:easier": {
    title: "agentLibrary.builtinCards.easier.title",
    desc: "agentLibrary.builtinCards.easier.desc",
  },
  "builtin:action:swap_roles": {
    title: "agentLibrary.builtinCards.swapRoles.title",
    desc: "agentLibrary.builtinCards.swapRoles.desc",
  },
  "builtin:action:next_day": {
    title: "agentLibrary.builtinCards.nextDay.title",
    desc: "agentLibrary.builtinCards.nextDay.desc",
  },
  "builtin:action:change_scene": {
    title: "agentLibrary.builtinCards.changeScene.title",
    desc: "agentLibrary.builtinCards.changeScene.desc",
  },
  "builtin:action:lesson_from_conversation": {
    title: "agentLibrary.builtinCards.lessonFromConversation.title",
    desc: "agentLibrary.builtinCards.lessonFromConversation.desc",
  },
};

function cardTitle(entry: AgentCatalogEntry, t: TFunction): string {
  const fallback = entry.card?.title ?? entry.id;
  if (entry.id.startsWith("custom:")) return fallback;
  if (getBuiltinAgentOverride(entry.id)?.label) return fallback;
  const keys = BUILTIN_CARD_I18N[entry.id];
  return keys ? t(keys.title) : fallback;
}

function cardDesc(entry: AgentCatalogEntry, t: TFunction): string | undefined {
  const fallback = entry.card?.description;
  if (entry.id.startsWith("custom:")) return fallback;
  if (getBuiltinAgentOverride(entry.id)?.description) return fallback;
  const keys = BUILTIN_CARD_I18N[entry.id];
  return keys ? t(keys.desc) : fallback;
}

// Lightweight centered modal (no extra dependency): backdrop click + Escape close.
// Mirrors confirm.tsx's visual language; the panel scrolls when the form is tall.
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
      {/* Focusable backdrop: keyboard-accessible click-to-dismiss without div onClick handlers. */}
      <button
        type="button"
        aria-label={t("common.cancel")}
        className="fixed inset-0 bg-black/40 animate-in fade-in-0"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative my-8 w-[min(40rem,calc(100vw-2rem))] rounded-2xl border bg-card p-5 shadow-lg animate-in zoom-in-95 fade-in-0"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="m-0 text-ui-title font-semibold">{title}</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-ui-muted hover:text-foreground"
            aria-label={t("common.cancel")}
            onClick={onClose}
          >
            <XIcon size={16} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Built-in capability fine-tune editor: appends supplemental instructions after
// the official base prompt (does not replace it). Rendered inside the editor modal.
function BuiltinTuneEditor({
  entry,
  onDone,
  onCancel,
}: {
  entry: AgentCatalogEntry;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const id = entry.id;
  const ov = getBuiltinAgentOverride(id);
  const [instructions, setInstructions] = useState(ov?.instructions ?? "");
  const actionDefault = BUILTIN_ACTION_DEFAULTS[id];
  const isTutor = id === "builtin:tutor";
  const overridden = Boolean(ov?.instructions);

  function save() {
    setBuiltinAgentOverride(id, { instructions });
    onDone(
      instructions.trim()
        ? t("agentLibrary.supplementalSaved")
        : t("agentLibrary.supplementalCleared"),
    );
  }

  function reset() {
    clearBuiltinAgentOverride(id);
    onDone(t("agentLibrary.restoredDefaults"));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-ui-caption text-ui-muted">
          {t("agentLibrary.advancedBadge")}
        </span>
        <p className="m-0 text-ui-caption leading-relaxed text-ui-muted">
          {t("agentLibrary.tuneAdvancedHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">
          {t("agentLibrary.officialBase")}
        </span>
        <p className="m-0 text-ui-caption leading-relaxed text-foreground-80">
          {cardDesc(entry, t)}
        </p>
        {actionDefault && (
          <pre className="mt-1 mb-0 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-muted px-2 py-1.5 font-mono text-ui-caption leading-relaxed text-ui-muted">
            {actionDefault.objective}
          </pre>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">
          {t("agentLibrary.supplemental")}
        </span>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t("agentLibrary.supplementalPlaceholder")}
          className="min-h-24 resize-y text-ui-caption leading-relaxed"
        />
      </div>
      {isTutor && (
        <p className="m-0 text-ui-caption leading-relaxed text-warning">
          {t("agentLibrary.tutorWarning")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={save}>
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {overridden && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-ui-muted"
            onClick={reset}
          >
            {t("agentLibrary.restoreDefaults")}
          </Button>
        )}
      </div>
    </div>
  );
}

// Output preview: shows expected output shape for observer vs action agents.
function OutputPreview({ kind }: { kind: LearningAgentKind }) {
  const { t } = useTranslation();
  if (kind === "reply_transformer") {
    return (
      <span className="text-ui-caption text-ui-muted">
        {t("agentLibrary.outputPreviewReplyTransformer")}
      </span>
    );
  }
  const example =
    kind === "observer"
      ? `{
  "title": "Interview expression observation",
  "body_md": "You said "负责" but a more natural phrasing is ...",
  "memory_proposals": [ /* written only after your confirmation */ ]
}`
      : `{
  "title": "Coffee shop order",
  "scenario": "You are at a busy coffee shop ordering ...",
  "opening_instruction": "Greet the barista and place your order in your target language"
}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-caption text-ui-muted">
        {kind === "observer"
          ? t("agentLibrary.outputPreviewObserver")
          : t("agentLibrary.outputPreviewAction")}
      </span>
      <pre className="m-0 overflow-x-auto rounded-md bg-muted px-2.5 py-2 font-mono text-ui-caption leading-relaxed text-ui-muted">
        {example}
      </pre>
    </div>
  );
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui-caption font-medium text-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

// The create / edit form for a custom agent. Owns its own field + busy state, initialized
// from `initial` (null = create). On success it reloads the runtime agents and calls onSaved.
function CustomAgentForm({
  initial,
  onSaved,
  onCancel,
  openDataScopeGuide,
}: {
  initial: LearningAgentMeta | null;
  onSaved: (msg: string) => void;
  onCancel: () => void;
  openDataScopeGuide: () => void;
}) {
  const { t } = useTranslation();
  const editingId = initial?.id ?? null;
  const [kind, setKind] = useState<LearningAgentKind>(
    initial &&
      (initial.kind === "action" || initial.kind === "reply_transformer")
      ? initial.kind
      : "observer",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [scopes, setScopes] = useState<LearningDataScope[]>(
    initial?.dataScopes.length ? initial.dataScopes : ["profile", "weak_all"],
  );
  const [writebackPolicy, setWritebackPolicy] =
    useState<LearningAgentWritebackPolicy>(initial?.writebackPolicy ?? "none");
  const [icon, setIcon] = useState<string>(
    initial?.icon ?? DEFAULT_REPLY_TRANSFORMER_ICON,
  );
  const [autoRun, setAutoRun] = useState(initial?.autoRun === 1);
  const [outputMode, setOutputMode] = useState<LearningAgentOutputMode>(
    initial?.outputMode ?? "panel",
  );
  const [stage, setStage] = useState<TransformerStage>(
    initial?.transformerStage ?? "ai_reply",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "replace" only makes sense under the AI reply — the user bubble already hosts the
  // correction + "more natural" rewrite, so it is dropped for the user_message stage.
  const outputModes: LearningAgentOutputMode[] =
    stage === "user_message"
      ? ["panel", "coach", "memory"]
      : ["panel", "replace", "coach", "memory"];

  function changeStage(next: TransformerStage) {
    setStage(next);
    if (next === "user_message" && outputMode === "replace")
      setOutputMode("panel");
  }

  function toggleScope(scope: LearningDataScope) {
    setScopes((prev) =>
      prev.includes(scope)
        ? prev.length === 1
          ? prev
          : prev.filter((s) => s !== scope)
        : [...prev, scope],
    );
  }

  async function submit() {
    if (!name.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fields = {
        name,
        description: description.trim() || name,
        prompt,
        kind,
        hook: hookForKind(kind),
        dataScopes: scopes,
        writebackPolicy:
          kind === "observer" ? writebackPolicy : ("none" as const),
        outputSchema: defaultAgentOutputSchema(kind),
        icon: kind === "reply_transformer" ? icon : null,
        autoRun: kind === "reply_transformer" ? autoRun : false,
        outputMode: kind === "reply_transformer" ? outputMode : undefined,
        transformerStage: kind === "reply_transformer" ? stage : undefined,
      };
      if (editingId) {
        await updateLearningAgent(editingId, fields);
      } else {
        await createLearningAgent({
          ...fields,
          allowedTools: ["read_learning_data"],
          enabled: true,
        });
      }
      await reloadCustomRuntimeAgents();
      onSaved(
        editingId
          ? t("agentLibrary.customUpdated")
          : t("agentLibrary.customCreated"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const typeOptions: { v: LearningAgentKind; title: string; desc: string }[] = [
    {
      v: "observer",
      title: t("agentLibrary.observerTitle"),
      desc: t("agentLibrary.observerDesc"),
    },
    {
      v: "action",
      title: t("agentLibrary.actionTitle"),
      desc: t("agentLibrary.actionDesc"),
    },
    {
      v: "reply_transformer",
      title: t("agentLibrary.replyTransformerTitle"),
      desc: t("agentLibrary.replyTransformerDesc"),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FormSection title={t("agentLibrary.basicInfo")}>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("agentLibrary.namePlaceholder")}
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("agentLibrary.descPlaceholder")}
          />
        </div>
      </FormSection>

      <FormSection title={t("agentLibrary.type")}>
        <div className="grid gap-2 sm:grid-cols-3">
          {typeOptions.map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setKind(opt.v)}
              className={cn(
                "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                kind === opt.v
                  ? "border-primary bg-primary/5"
                  : "bg-background hover:bg-accent",
              )}
            >
              <span className="font-medium">{opt.title}</span>
              <span className="text-ui-caption text-ui-muted">{opt.desc}</span>
            </button>
          ))}
        </div>
      </FormSection>

      {kind === "reply_transformer" && (
        <FormSection title={t("agentLibrary.stageLabel")}>
          <Select
            value={stage}
            onValueChange={(v) => changeStage(v as TransformerStage)}
          >
            <SelectTrigger className="md:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ai_reply">
                {t("agentLibrary.stageAiReply")}
              </SelectItem>
              <SelectItem value="user_message">
                {t("agentLibrary.stageUserMessage")}
              </SelectItem>
            </SelectContent>
          </Select>
          <span className="text-ui-caption text-ui-muted">
            {stage === "user_message"
              ? t("agentLibrary.stageUserMessageHint")
              : t("agentLibrary.stageAiReplyHint")}
          </span>
        </FormSection>
      )}

      <FormSection title={t("agentLibrary.readableData")}>
        <div className="flex flex-wrap gap-1.5">
          {LEARNING_DATA_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              className={cn(
                "rounded-md border px-2 py-1 text-ui-caption",
                scopes.includes(scope)
                  ? "border-border bg-accent text-foreground"
                  : "bg-background text-foreground-80",
              )}
              onClick={() => toggleScope(scope)}
              title={DATA_SCOPE_LABELS[scope]}
            >
              {scopeName(scope, t)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="self-start text-ui-caption text-ui-muted hover:text-foreground"
          onClick={openDataScopeGuide}
        >
          {t("agentLibrary.howToChooseScopes")}
        </button>
      </FormSection>

      {kind === "observer" && (
        <FormSection title={t("agentLibrary.writebackPolicy")}>
          <Select
            value={writebackPolicy}
            onValueChange={(v) =>
              setWritebackPolicy(v as LearningAgentWritebackPolicy)
            }
          >
            <SelectTrigger className="md:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("agentLibrary.writebackNone")}
              </SelectItem>
              <SelectItem value="propose_review_signals">
                {t("agentLibrary.writebackPropose")}
              </SelectItem>
            </SelectContent>
          </Select>
        </FormSection>
      )}

      {kind === "reply_transformer" && (
        <>
          <FormSection title={t("agentLibrary.iconLabel")}>
            <div className="flex flex-wrap gap-1.5">
              {REPLY_TRANSFORMER_ICON_NAMES.map((n) => {
                const Icon = replyTransformerIcon(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setIcon(n)}
                    aria-pressed={icon === n}
                    aria-label={n}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-md border",
                      icon === n
                        ? "border-primary bg-primary/5 text-foreground"
                        : "bg-background text-ui-muted hover:bg-accent",
                    )}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
            </div>
          </FormSection>
          <FormSection title={t("agentLibrary.outputModeLabel")}>
            <Select
              value={outputMode}
              onValueChange={(v) => setOutputMode(v as LearningAgentOutputMode)}
            >
              <SelectTrigger className="md:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {outputModes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(
                      `agentLibrary.outputMode${
                        m.charAt(0).toUpperCase() + m.slice(1)
                      }` as Parameters<TFunction>[0],
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormSection>
          <FormSection title={t("agentLibrary.autoRunLabel")}>
            <div className="flex items-center gap-2">
              <Switch checked={autoRun} onCheckedChange={setAutoRun} />
              <span className="text-ui-caption text-ui-muted">
                {t("agentLibrary.autoRunHint")}
              </span>
            </div>
          </FormSection>
        </>
      )}

      <FormSection title="Prompt">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            kind === "observer"
              ? t("agentLibrary.observerPromptPlaceholder")
              : kind === "reply_transformer"
                ? t("agentLibrary.replyTransformerPromptPlaceholder")
                : t("agentLibrary.actionPromptPlaceholder")
          }
          className="min-h-28 resize-y font-mono text-ui-caption leading-relaxed"
        />
        <OutputPreview kind={kind} />
      </FormSection>

      {error && (
        <div className="rounded-md bg-destructive/15 px-3 py-2 text-ui-body text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !prompt.trim()}
        >
          {editingId ? <PencilIcon size={14} /> : <PlusIcon size={14} />}
          {editingId
            ? t("agentLibrary.saveChanges")
            : t("agentLibrary.createAndEnable")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

// One compact divider row in the capability list.
function AgentRow({
  entry,
  onToggle,
  onEdit,
  onExport,
  onDelete,
}: {
  entry: AgentCatalogEntry;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (entry: AgentCatalogEntry) => void;
  onExport: (id: string) => void;
  onDelete: (entry: AgentCatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const card = entry.card;
  const custom = entry.id.startsWith("custom:");
  const isTransformer = entry.kind === "transformer" && card?.canDisable;
  const isReplyProducer = entry.kind === "reply_producer";
  // Main reply producers can't be deleted; other built-ins can be permanently hidden; custom agents are truly deleted.
  const canDelete = custom || !isReplyProducer;
  const Glyph = isTransformer ? replyTransformerIcon(entry.icon) : null;
  const title = cardTitle(entry, t);
  const description = cardDesc(entry, t);

  return (
    <div className="flex items-start gap-3 border-b py-3 last:border-b-0">
      {Glyph && (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-ui-muted">
          <Glyph size={15} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {custom && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-ui-caption text-primary">
              {t("agentLibrary.custom")}
            </span>
          )}
          {!entry.enabled && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-ui-caption text-ui-muted">
              {t("agentLibrary.disabled")}
            </span>
          )}
          {!card?.canDisable && !custom && (
            <span className="text-ui-caption text-ui-muted">
              {t("agentLibrary.alwaysOn")}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-0.5 mb-0 text-ui-caption leading-snug text-ui-muted">
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-ui-muted hover:text-foreground"
          title={t("agentLibrary.tuneTitle")}
          aria-label={t("agentLibrary.tuneTitle")}
          onClick={() => onEdit(entry)}
        >
          <PencilIcon size={15} />
        </Button>
        {custom && entry.kind !== "transformer" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-ui-muted hover:text-foreground"
            title={t("agentLibrary.exportTitle")}
            aria-label={t("agentLibrary.exportTitle")}
            onClick={() => onExport(entry.id)}
          >
            <DownloadIcon size={15} />
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-ui-muted hover:text-destructive"
            title={t("agentLibrary.deleteTitle")}
            aria-label={t("agentLibrary.deleteTitle")}
            onClick={() => onDelete(entry)}
          >
            <Trash2Icon size={15} />
          </Button>
        )}
        {card?.canDisable && (
          <Switch
            checked={entry.enabled}
            onCheckedChange={(v) => onToggle(entry.id, v)}
            aria-label={
              entry.enabled
                ? t("agentLibrary.disabled")
                : t("agentLibrary.alwaysOn")
            }
            className="ml-1"
          />
        )}
      </div>
    </div>
  );
}

type EditorState =
  | { mode: "new" }
  | { mode: "custom"; agent: LearningAgentMeta }
  | { mode: "builtin"; entry: AgentCatalogEntry }
  | null;

export function AgentLibraryView({
  onOpenView,
}: {
  onOpenView?: (view: MainView) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>(() =>
    listAgentCatalog(),
  );
  const [editor, setEditor] = useState<EditorState>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [packageText, setPackageText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, enabled: boolean) {
    setAgentEnabled(id, enabled);
    setCatalog(listAgentCatalog());
  }

  function refreshList() {
    setCatalog(listAgentCatalog());
  }

  function openDataScopeGuide() {
    void openUrl(`${WEBSITE_DESIGN_URL}#data-scopes`);
  }

  async function openEditor(entry: AgentCatalogEntry) {
    setError(null);
    setMessage(null);
    if (!entry.id.startsWith("custom:")) {
      setEditor({ mode: "builtin", entry });
      return;
    }
    try {
      const agent = await getLearningAgent(entry.id.replace(/^custom:/, ""));
      if (!agent) {
        setError(t("agentLibrary.agentNotFound"));
        return;
      }
      setEditor({ mode: "custom", agent });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onEditorSaved(msg: string) {
    refreshList();
    setMessage(msg);
    setEditor(null);
  }

  async function deleteEntry(entry: AgentCatalogEntry) {
    const title = entry.card?.title ?? entry.id;
    if (entry.id.startsWith("custom:")) {
      if (
        !(await confirm({
          title: t("agentLibrary.deleteCustomTitle", { name: title }),
          description: t("agentLibrary.deleteCustomDesc"),
        }))
      )
        return;
      try {
        await deleteLearningAgent(entry.id.replace(/^custom:/, ""));
        await reloadCustomRuntimeAgents();
        refreshList();
        setMessage(t("agentLibrary.deleted", { name: title }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (
      !(await confirm({
        title: t("agentLibrary.deleteBuiltinTitle", { name: title }),
        description: t("agentLibrary.deleteBuiltinDesc"),
      }))
    )
      return;
    hideAgent(entry.id);
    refreshList();
    setMessage(t("agentLibrary.deleted", { name: title }));
  }

  async function exportPackage(entryId: string) {
    setError(null);
    setMessage(null);
    try {
      const agentId = entryId.replace(/^custom:/, "");
      const text = await exportAgentPackage(agentId);
      setPackageText(text);
      setAdvancedOpen(true);
      setMessage(t("agentLibrary.exportedTo"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function importPackage() {
    if (!packageText.trim() || busy || !packageReview) return;
    if (
      !(await confirm({
        title: t("agentLibrary.importConfirmTitle", {
          name: packageReview.name,
        }),
        description: t("agentLibrary.importConfirmDesc", {
          summary: packageReview.itemSummary,
        }),
        confirmText: t("agentLibrary.importPackage"),
      }))
    )
      return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await importAgentPackage(packageText, {
        enableRuntimeAgents: false,
        enableLessons: true,
      });
      refreshList();
      setMessage(
        t("agentLibrary.importedPackage", {
          skills: String(result.runtimeSkillCount),
          lessons: String(result.lessonCount),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const packageReview = useMemo(() => {
    if (!packageText.trim()) return null;
    try {
      return reviewAgentPackage(packageText);
    } catch {
      return null;
    }
  }, [packageText]);

  const grouped = ENTRY_ORDER.map((entry) => ({
    entry,
    items: catalog.filter((e) => entryOf(e) === entry),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mt-0 mb-1 text-ui-title font-semibold">
            {t("agentLibrary.title")}
          </h2>
          <p className="m-0 text-ui-body text-ui-muted">
            {t("agentLibrary.description")}
          </p>
          <button
            type="button"
            className="mt-1.5 block text-ui-caption text-ui-muted hover:text-foreground"
            onClick={() => onOpenView?.("settings-customize")}
          >
            {t("agentLibrary.toPreferences")}
          </button>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setError(null);
            setMessage(null);
            setEditor({ mode: "new" });
          }}
        >
          <PlusIcon size={14} />
          {t("agentLibrary.newAgent")}
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        {grouped.map((group) => (
          <section key={group.entry} className="flex flex-col">
            <div className="mb-1">
              <h3 className="m-0 text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
                {t(
                  `agentLibrary.entryMeta.${group.entry}.label` as Parameters<TFunction>[0],
                )}
              </h3>
              <p className="mt-0.5 mb-0 text-ui-caption text-ui-muted">
                {t(
                  `agentLibrary.entryMeta.${group.entry}.intro` as Parameters<TFunction>[0],
                )}
              </p>
            </div>
            <div className="flex flex-col">
              {group.items.map((entry) => (
                <AgentRow
                  key={entry.id}
                  entry={entry}
                  onToggle={toggle}
                  onEdit={(e) => void openEditor(e)}
                  onExport={exportPackage}
                  onDelete={(e) => void deleteEntry(e)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-6 rounded-lg border bg-card">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3.5 py-3 text-ui-body font-semibold"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <ChevronDownIcon
            size={15}
            className={cn("transition-transform", advancedOpen && "rotate-180")}
          />
          {t("agentLibrary.advanced")}
        </button>
        {advancedOpen && (
          <div className="border-t px-3.5 py-3">
            <Textarea
              value={packageText}
              onChange={(e) => setPackageText(e.target.value)}
              placeholder={t("agentLibrary.packagePlaceholder")}
              className="min-h-32 resize-y font-mono text-ui-caption leading-relaxed"
            />
            {packageReview && (
              <div className="mt-2 rounded-md bg-muted px-2.5 py-2 text-ui-caption leading-relaxed">
                <div className="font-medium">{packageReview.name}</div>
                <div className="text-ui-muted">
                  {packageReview.itemSummary} · {t("agentLibrary.reads")}:{" "}
                  {packageReview.reads} ·{t("agentLibrary.writes")}:{" "}
                  {packageReview.writes}
                </div>
                <div className="mt-2 grid gap-1">
                  {packageReview.items.map((item, i) => (
                    <div
                      key={`${item.type}:${item.name}:${i}`}
                      className="rounded border bg-background px-2 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {item.name}
                        </span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-ui-caption text-ui-muted">
                          {item.type}
                        </span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-ui-muted">
                        {item.description}
                      </div>
                      <div className="mt-1 text-ui-muted">
                        {item.enabledByDefault
                          ? t("agentLibrary.importEnabled")
                          : t("agentLibrary.importDisabled")}
                        {" · "}
                        {item.reads}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void importPackage()}
              disabled={busy || !packageText.trim() || !packageReview}
            >
              <UploadIcon size={14} />
              {t("agentLibrary.importPackage")}
            </Button>
          </div>
        )}
      </section>

      {message && (
        <div className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-ui-body text-primary">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-destructive/15 px-3 py-2 text-ui-body text-destructive">
          {error}
        </div>
      )}

      {editor && (
        <Modal
          title={
            editor.mode === "builtin"
              ? cardTitle(editor.entry, t)
              : editor.mode === "custom"
                ? t("agentLibrary.editCustom")
                : t("agentLibrary.createCustom")
          }
          onClose={() => setEditor(null)}
        >
          {editor.mode === "builtin" ? (
            <BuiltinTuneEditor
              entry={editor.entry}
              onDone={onEditorSaved}
              onCancel={() => setEditor(null)}
            />
          ) : (
            <CustomAgentForm
              key={editor.mode === "custom" ? editor.agent.id : "new"}
              initial={editor.mode === "custom" ? editor.agent : null}
              onSaved={onEditorSaved}
              onCancel={() => setEditor(null)}
              openDataScopeGuide={openDataScopeGuide}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
