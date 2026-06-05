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

// 能力库:把 Agent Runtime 里注册的能力按【入口】分组展示(你在哪触发它 / 它何时出现),
// 而不是技术 kind。每个能力可微调(追加补充指令)、启停、删除(内置=永久隐藏,自定义=真删)。

// 入口分组:顺序 + 标题 + 一句话简介。
const ENTRY_ORDER: AgentEntry[] = [
  "auto_turn",
  "selection",
  "reply_action",
  "derive",
  "lesson",
];

const ENTRY_META: Record<AgentEntry, { label: string; intro: string }> = {
  auto_turn: {
    label: "每轮自动",
    intro: "你每说一句,这些能力自动在后台运行,结果出现在教练面板。",
  },
  selection: {
    label: "选中文字时",
    intro: "在消息里划选词或句子时浮出的学习动作。",
  },
  reply_action: {
    label: "回复操作按钮",
    intro: "每条回复下方的按钮,点一下即用。",
  },
  derive: {
    label: "衍生新对话",
    intro: "点击后基于当前会话生成一个全新对话,不改动原对话。",
  },
  lesson: {
    label: "专项课",
    intro: "在专项课会话里给你上课的老师。",
  },
};

// 行级「输入 → 输出」摘要,按入口给一句普通话说明。
const ENTRY_IO: Record<AgentEntry, string> = {
  auto_turn: "你这一句 → 教练面板里的批改 / 注释",
  selection: "选中的词句 + 上下文 → 母语解析",
  reply_action: "当前这条回复 → 讲解 / 双语 / 推荐回复文本",
  derive: "当前会话 → 一个全新对话",
  lesson: "你的消息 → 老师型课堂回复",
};

function scopeName(scope: LearningDataScope): string {
  return DATA_SCOPE_LABELS[scope].split(":")[0];
}

function hookForKind(kind: LearningAgentKind) {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  return null;
}

function entryOf(entry: AgentCatalogEntry): AgentEntry {
  // 没有 card 的（理论上不会发生）兜底进「每轮自动」。
  return entry.card?.entry ?? "auto_turn";
}

// 内置能力微调:在官方基础设定之上【追加】补充指令(不替换基础 prompt)。
// 对话衍生动作额外展示官方目标(只读)让用户知道在往什么后面追加。
function BuiltinTuneEditor({
  entry,
  onDone,
  onCancel,
}: {
  entry: AgentCatalogEntry;
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
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
        ? "补充指令已保存。"
        : "补充指令已清空,恢复官方默认。",
    );
  }

  function reset() {
    clearBuiltinAgentOverride(id);
    onDone("已恢复官方默认。");
  }

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">
          官方基础设定(只读)
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
          补充指令(追加在官方设定之后,不替换基础 prompt)
        </span>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="例如:讲解时多举一个我所在行业的例子;语气更简短直接。"
          className="min-h-24 resize-y text-ui-caption leading-relaxed"
        />
      </div>
      {isTutor && (
        <p className="m-0 text-ui-caption leading-relaxed text-warning">
          提示:给批改导师写与系统相冲突的指令可能降低批改质量。随时可「恢复默认」。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={save}>
          保存
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        {overridden && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-ui-muted"
            onClick={reset}
          >
            恢复默认
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
  const card = entry.card;
  const custom = entry.id.startsWith("custom:");
  const isReplyProducer = entry.kind === "reply_producer";
  // 主回复(对话伙伴 / 专项课老师)不可删;其余内置可永久隐藏,自定义走 DB 真删。
  const canDelete = custom || !isReplyProducer;
  const io = card ? ENTRY_IO[card.entry] : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{card?.title ?? entry.id}</span>
            {custom && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-ui-caption text-primary">
                自定义
              </span>
            )}
            {!entry.enabled && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-ui-caption text-ui-muted">
                已停用
              </span>
            )}
            {!card?.canDisable && !custom && (
              <span className="text-ui-caption text-ui-muted">常驻</span>
            )}
          </div>
          {card?.description && (
            <p className="mt-1 mb-0 text-ui-body leading-snug text-ui-muted">
              {card.description}
            </p>
          )}
        </div>
        {card?.canDisable && (
          <Switch
            checked={entry.enabled}
            onCheckedChange={(v) => onToggle(entry.id, v)}
            aria-label={entry.enabled ? "禁用" : "启用"}
          />
        )}
      </div>
      {card && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ui-caption">
          {io && (
            <>
              <dt className="text-ui-muted">输入 → 输出</dt>
              <dd className="m-0 text-foreground">{io}</dd>
            </>
          )}
          <dt className="text-ui-muted">运行时机</dt>
          <dd className="m-0 text-foreground">{card.timing}</dd>
          <dt className="text-ui-muted">读取</dt>
          <dd className="m-0 text-foreground">{card.reads}</dd>
          <dt className="text-ui-muted">写入</dt>
          <dd className="m-0 text-foreground">{card.writes}</dd>
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {custom ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEditCustom(entry.id)}
            >
              <PencilIcon size={14} />
              编辑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onExport(entry.id)}
            >
              <DownloadIcon size={14} />
              导出包
            </Button>
          </>
        ) : (
          !tuning && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onTune(entry.id)}
            >
              <PencilIcon size={14} />
              微调
            </Button>
          )
        )}
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-ui-muted hover:text-destructive"
            onClick={() => onDelete(entry)}
          >
            <Trash2Icon size={14} />
            删除
          </Button>
        )}
      </div>
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

// 创建/编辑自定义 Agent 时按所选 kind 给出的输出预览(教练面板里长什么样 / 会做什么)。
function OutputPreview({ kind }: { kind: LearningAgentKind }) {
  const example =
    kind === "observer"
      ? `{
  "title": "面试表达观察",
  "body_md": "你把「负责」说成了 ...,更自然的说法是 ...",
  "memory_proposals": [ /* 需你确认后才写入学习数据 */ ]
}`
      : `{
  "title": "咖啡店点单",
  "scenario": "你在一家忙碌的咖啡店点单 ...",
  "opening_instruction": "用目标语言主动跟店员打招呼并点单"
}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ui-caption text-ui-muted">
        {kind === "observer"
          ? "输出 → 教练面板里的一条注释(memory_proposals 需你确认后才写入)"
          : "输出 → 一个新对话上下文,自动开一个新对话"}
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
        setError("找不到这个自定义 Agent。");
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
        setMessage("自定义 Agent 已更新。");
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
        setMessage("自定义 Agent 已创建并启用。");
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
          title: `删除自定义 Agent「${title}」?`,
          description: "会从数据库永久删除,不可恢复。已有会话不受影响。",
        }))
      )
        return;
      try {
        await deleteLearningAgent(entry.id.replace(/^custom:/, ""));
        await refreshCatalog();
        setMessage(`已删除「${title}」。`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (
      !(await confirm({
        title: `删除能力「${title}」?`,
        description:
          "永久隐藏这个内置能力,不可恢复——需要清空应用数据才能找回。",
      }))
    )
      return;
    hideAgent(entry.id);
    if (tuneId === entry.id) setTuneId(null);
    setCatalog(listAgentCatalog());
    setMessage(`已删除「${title}」。`);
  }

  async function exportPackage(entryId: string) {
    setError(null);
    setMessage(null);
    try {
      const agentId = entryId.replace(/^custom:/, "");
      const text = await exportAgentPackage(agentId);
      setPackageText(text);
      setAdvancedOpen(true);
      setMessage("已导出到下方「高级」里的包文本框。");
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
      await importAgentPackage(packageText);
      await refreshCatalog();
      setMessage("包已导入并启用。");
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
      <h2 className="mt-0 mb-1 text-ui-title font-semibold">能力库</h2>
      <p className="mt-0 mb-5 text-ui-body text-ui-muted">
        按【入口】组织的全部能力——每组告诉你在哪触发、何时出现。可以微调(追加补充指令)、启用/禁用,或删除不用的能力。
        删除内置能力是永久隐藏,删除自定义 Agent
        会真正删掉,都不影响你的学习数据。
      </p>

      <section ref={formRef} className="mb-6 rounded-lg border bg-card p-4">
        <h3 className="m-0 mb-3 text-ui-body font-semibold">
          {editingId ? "编辑自定义 Agent" : "创建自定义 Agent"}
        </h3>
        <div className="flex flex-col gap-4">
          <FormSection title="基本信息">
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="名称,例如:面试表达观察"
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话说明它做什么"
              />
            </div>
          </FormSection>

          <FormSection title="类型">
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    v: "observer" as const,
                    title: "观察 Agent",
                    desc: "每轮自动在后台观察你的输入,在教练面板留一条注释。",
                  },
                  {
                    v: "action" as const,
                    title: "对话衍生 Agent",
                    desc: "点击后基于当前会话生成一个全新对话。",
                  },
                ] satisfies {
                  v: LearningAgentKind;
                  title: string;
                  desc: string;
                }[]
              ).map((opt) => (
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

          <FormSection title="可读数据">
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
                  {scopeName(scope)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="self-start text-ui-caption text-ui-muted hover:text-foreground"
              onClick={openDataScopeGuide}
            >
              数据范围怎么选？
            </button>
          </FormSection>

          {kind === "observer" && (
            <FormSection title="写入策略">
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
                  <SelectItem value="none">只展示,不提议写入</SelectItem>
                  <SelectItem value="propose_review_signals">
                    可提议学习数据修改(需你确认)
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
                  ? "说明每轮要观察什么、如何反馈、何时提出 memory_proposals。"
                  : "说明点击按钮后要如何基于当前对话生成新的对话上下文。"
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
              {editingId ? "保存修改" : "创建并启用"}
            </Button>
            {editingId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetForm}
                disabled={busy}
              >
                取消
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
                {ENTRY_META[group.entry].label}
              </h3>
              <p className="mt-0.5 mb-0 text-ui-caption text-ui-muted">
                {ENTRY_META[group.entry].intro}
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
          高级 · Agent Package 导入导出
        </button>
        {advancedOpen && (
          <div className="border-t px-3.5 py-3">
            <Textarea
              value={packageText}
              onChange={(e) => setPackageText(e.target.value)}
              placeholder="粘贴 lang-agent.agent-package JSON;导出包也会出现在这里。"
              className="min-h-32 resize-y font-mono text-ui-caption leading-relaxed"
            />
            {packageReview && (
              <div className="mt-2 rounded-md bg-muted px-2.5 py-2 text-ui-caption leading-relaxed">
                <div className="font-medium">{packageReview.name}</div>
                <div className="text-ui-muted">
                  读取: {packageReview.reads} · 写入: {packageReview.writes}
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
              导入包
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
        运行日志已移到「设置 → 日志」
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
