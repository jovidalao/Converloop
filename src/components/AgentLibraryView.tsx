import {
  ChevronDownIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  ScrollTextIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
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
  type LearningAgentWritebackPolicy,
  type LearningDataScope,
  updateLearningAgent,
} from "../db/learning-agents";
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
import { APP_DESIGN_DATA_SCOPES_HASH } from "./AppDesignView";
import { useConfirm } from "./confirm";
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

// Capability library: displays registered capabilities grouped by entry point
// (where/when they trigger), not by technical kind.

const ENTRY_ORDER: AgentEntry[] = [
  "auto_turn",
  "selection",
  "reply_action",
  "derive",
  "lesson",
];

// Returns the i18n scope-name (first word before ":" in DATA_SCOPE_LABELS is
// the internal key; here we use the i18n label instead).
function scopeName(scope: LearningDataScope, t: TFunction): string {
  return t(`scopeLabel.${scope}.name` as Parameters<TFunction>[0]);
}

function hookForKind(kind: LearningAgentKind) {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  return null;
}

function entryOf(entry: AgentCatalogEntry): AgentEntry {
  return entry.card?.entry ?? "auto_turn";
}

// Built-in capability fine-tune editor: appends supplemental instructions after
// the official base prompt (does not replace it).
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
    <div className="mt-1 flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">
          {t("agentLibrary.officialBase")}
        </span>
        <p className="m-0 text-ui-caption leading-relaxed text-foreground-80">
          {entry.card?.description}
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

function AgentRow({
  entry,
  onToggle,
  onTune,
  tuning,
  onTuneDone,
  onTuneCancel,
  onEditCustom,
  onExport,
  onDelete,
}: {
  entry: AgentCatalogEntry;
  onToggle: (id: string, enabled: boolean) => void;
  onTune: (id: string) => void;
  tuning: boolean;
  onTuneDone: (msg: string) => void;
  onTuneCancel: () => void;
  onEditCustom: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (entry: AgentCatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const card = entry.card;
  const custom = entry.id.startsWith("custom:");
  const isReplyProducer = entry.kind === "reply_producer";
  // Main reply producers (conversation partner / lesson teacher) cannot be deleted;
  // other built-ins can be permanently hidden; custom agents are truly deleted from DB.
  const canDelete = custom || !isReplyProducer;
  const io = card
    ? t(`agentLibrary.entryIo.${card.entry}` as Parameters<TFunction>[0])
    : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{card?.title ?? entry.id}</span>
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
          {card?.description && (
            <p className="mt-1 mb-0 text-ui-body leading-snug text-ui-muted">
              {card.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {custom ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-ui-muted hover:text-foreground"
                title={t("agentLibrary.tuneTitle")}
                aria-label={t("agentLibrary.tuneTitle")}
                onClick={() => onEditCustom(entry.id)}
              >
                <PencilIcon size={15} />
              </Button>
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
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-8",
                tuning
                  ? "bg-accent text-foreground"
                  : "text-ui-muted hover:text-foreground",
              )}
              title={t("agentLibrary.tuneTitle")}
              aria-label={t("agentLibrary.tuneTitle")}
              onClick={() => onTune(entry.id)}
            >
              <PencilIcon size={15} />
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
      {card && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui-caption">
          {io && (
            <>
              <dt className="text-ui-muted">{t("agentLibrary.inputOutput")}</dt>
              <dd className="m-0 text-foreground">{io}</dd>
            </>
          )}
          <dt className="text-ui-muted">{t("agentLibrary.timing")}</dt>
          <dd className="m-0 text-foreground">{card.timing}</dd>
          <dt className="text-ui-muted">{t("agentLibrary.reads")}</dt>
          <dd className="m-0 text-foreground">{card.reads}</dd>
          <dt className="text-ui-muted">{t("agentLibrary.writes")}</dt>
          <dd className="m-0 text-foreground">{card.writes}</dd>
        </dl>
      )}
      {!custom && tuning && (
        <BuiltinTuneEditor
          entry={entry}
          onDone={onTuneDone}
          onCancel={onTuneCancel}
        />
      )}
    </div>
  );
}

// Output preview: shows expected output shape for observer vs action agents.
function OutputPreview({ kind }: { kind: LearningAgentKind }) {
  const { t } = useTranslation();
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
  const [kind, setKind] = useState<LearningAgentKind>("observer");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scopes, setScopes] = useState<LearningDataScope[]>([
    "profile",
    "weak_all",
  ]);
  const [writebackPolicy, setWritebackPolicy] =
    useState<LearningAgentWritebackPolicy>("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tuneId, setTuneId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [packageText, setPackageText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);

  function toggle(id: string, enabled: boolean) {
    setAgentEnabled(id, enabled);
    setCatalog(listAgentCatalog());
  }

  async function refreshCatalog() {
    await reloadCustomRuntimeAgents();
    setCatalog(listAgentCatalog());
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

  function resetForm() {
    setEditingId(null);
    setKind("observer");
    setName("");
    setDescription("");
    setPrompt("");
    setScopes(["profile", "weak_all"]);
    setWritebackPolicy("none");
  }

  function openDataScopeGuide() {
    window.location.hash = APP_DESIGN_DATA_SCOPES_HASH;
    onOpenView?.("design");
  }

  async function startEdit(entryId: string) {
    setError(null);
    setMessage(null);
    try {
      const agent = await getLearningAgent(entryId.replace(/^custom:/, ""));
      if (!agent) {
        setError(t("agentLibrary.agentNotFound"));
        return;
      }
      setEditingId(agent.id);
      setKind(agent.kind === "action" ? "action" : "observer");
      setName(agent.name);
      setDescription(agent.description);
      setPrompt(agent.prompt);
      setScopes(agent.dataScopes.length ? agent.dataScopes : ["weak_all"]);
      setWritebackPolicy(agent.writebackPolicy);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitCustomAgent() {
    if (!name.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (editingId) {
        await updateLearningAgent(editingId, {
          name,
          description: description.trim() || name,
          prompt,
          kind,
          hook: hookForKind(kind),
          dataScopes: scopes,
          writebackPolicy: kind === "observer" ? writebackPolicy : "none",
          outputSchema: defaultAgentOutputSchema(kind),
        });
        resetForm();
        await refreshCatalog();
        setMessage(t("agentLibrary.customUpdated"));
      } else {
        await createLearningAgent({
          name,
          description: description.trim() || name,
          prompt,
          kind,
          hook: hookForKind(kind),
          dataScopes: scopes,
          allowedTools: ["read_learning_data"],
          writebackPolicy: kind === "observer" ? writebackPolicy : "none",
          outputSchema: defaultAgentOutputSchema(kind),
          enabled: true,
        });
        resetForm();
        await refreshCatalog();
        setMessage(t("agentLibrary.customCreated"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
        await refreshCatalog();
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
    if (tuneId === entry.id) setTuneId(null);
    setCatalog(listAgentCatalog());
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
    if (!packageText.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await importAgentPackage(packageText, {
        enableRuntimeAgents: true,
        enableLessons: true,
      });
      await refreshCatalog();
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
  ];

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-1 text-ui-title font-semibold">
        {t("agentLibrary.title")}
      </h2>
      <p className="mt-0 mb-5 text-ui-body text-ui-muted">
        {t("agentLibrary.description")}
      </p>

      <section ref={formRef} className="mb-6 rounded-lg border bg-card p-4">
        <h3 className="m-0 mb-3 text-ui-body font-semibold">
          {editingId
            ? t("agentLibrary.editCustom")
            : t("agentLibrary.createCustom")}
        </h3>
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
            <div className="grid gap-2 sm:grid-cols-2">
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
                  <span className="text-ui-caption text-ui-muted">
                    {opt.desc}
                  </span>
                </button>
              ))}
            </div>
          </FormSection>

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

          <FormSection title="Prompt">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                kind === "observer"
                  ? t("agentLibrary.observerPromptPlaceholder")
                  : t("agentLibrary.actionPromptPlaceholder")
              }
              className="min-h-28 resize-y font-mono text-ui-caption leading-relaxed"
            />
            <OutputPreview kind={kind} />
          </FormSection>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void submitCustomAgent()}
              disabled={busy || !name.trim() || !prompt.trim()}
            >
              {editingId ? <PencilIcon size={14} /> : <PlusIcon size={14} />}
              {editingId
                ? t("agentLibrary.saveChanges")
                : t("agentLibrary.createAndEnable")}
            </Button>
            {editingId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetForm}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-6">
        {grouped.map((group) => (
          <section key={group.entry} className="flex flex-col gap-2">
            <div>
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
            {group.items.map((entry) => (
              <AgentRow
                key={entry.id}
                entry={entry}
                onToggle={toggle}
                onTune={(id) => setTuneId((cur) => (cur === id ? null : id))}
                tuning={tuneId === entry.id}
                onTuneDone={(msg) => {
                  setTuneId(null);
                  setCatalog(listAgentCatalog());
                  setMessage(msg);
                }}
                onTuneCancel={() => setTuneId(null)}
                onEditCustom={(id) => void startEdit(id)}
                onExport={exportPackage}
                onDelete={(e) => void deleteEntry(e)}
              />
            ))}
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

      <button
        type="button"
        className="mt-6 flex items-center gap-1.5 self-start text-ui-caption text-ui-muted hover:text-foreground"
        onClick={() => onOpenView?.("settings-logs")}
      >
        <ScrollTextIcon size={13} />
        {t("agentLibrary.logsLink")}
      </button>

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
    </div>
  );
}
