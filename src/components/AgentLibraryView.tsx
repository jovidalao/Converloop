import {
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  defaultAgentOutputSchema,
  exportAgentPackage,
  importAgentPackage,
  reviewAgentPackage,
} from "../agent-package";
import { listAgentJobs } from "../db/agent-jobs";
import {
  createLearningAgent,
  DATA_SCOPE_LABELS,
  getLearningAgent,
  LEARNING_DATA_SCOPES,
  type LearningAgentKind,
  type LearningAgentWritebackPolicy,
  type LearningDataScope,
  updateLearningAgent,
} from "../db/learning-agents";
import type { AgentJob } from "../db/schema";
import {
  type AgentCatalogEntry,
  type AgentKind,
  BUILTIN_ACTION_DEFAULTS,
  clearBuiltinActionOverride,
  getBuiltinActionOverride,
  listAgentCatalog,
  reloadCustomRuntimeAgents,
  setAgentEnabled,
  setBuiltinActionOverride,
} from "../runtime";
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

// 能力库:把 Agent Runtime 里注册的内置 Agent 展示成「能力」(做什么/何时跑/读写什么),
// 支持启用/禁用,并附运行日志。普通用户看能力,不看 hook/schema。

const KIND_LABEL: Record<AgentKind, string> = {
  reply_producer: "主回复",
  observer: "观察",
  transformer: "转换",
  action: "对话衍生",
  background: "后台",
};

const KIND_ORDER: AgentKind[] = [
  "reply_producer",
  "observer",
  "action",
  "transformer",
  "background",
];

const SOURCE_LABEL: Record<string, string> = {
  conversation: "对话",
  task_agent: "任务规划",
  maintainer: "档案维护",
  summary: "摘要",
  manual: "手动",
};

const JOB_STATUS_CLASS: Record<string, string> = {
  succeeded: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  running: "bg-warning/10 text-warning",
  pending: "bg-muted text-ui-muted",
};

function agentIdOf(job: AgentJob): string | null {
  if (!job.inputJson) return null;
  try {
    const raw = JSON.parse(job.inputJson) as { agentId?: string };
    return raw.agentId ?? null;
  } catch {
    return null;
  }
}

function durationLabel(job: AgentJob): string {
  if (job.startedAt && job.finishedAt)
    return `${job.finishedAt - job.startedAt}ms`;
  return "—";
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString();
}

// 内置对话衍生动作的就地编辑器:改名称/说明/prompt。prompt 即喂给衍生 Agent 的目标指令,
// 会拼到固定的系统 prompt 后面。保存写改写层(localStorage),「恢复默认」清掉改写。
function BuiltinActionEditor({
  id,
  onDone,
  onCancel,
}: {
  id: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const def = BUILTIN_ACTION_DEFAULTS[id];
  const ov = getBuiltinActionOverride(id);
  const [label, setLabel] = useState(ov?.label ?? def.label);
  const [description, setDescription] = useState(
    ov?.description ?? def.description,
  );
  const [objective, setObjective] = useState(ov?.objective ?? def.objective);
  const overridden = Boolean(ov);

  function save() {
    setBuiltinActionOverride(id, { label, description, objective });
    onDone();
  }

  function reset() {
    clearBuiltinActionOverride(id);
    onDone();
  }

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">名称</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">说明</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-ui-caption text-ui-muted">
          Prompt(给衍生 Agent 的目标指令)
        </span>
        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          className="min-h-28 resize-y font-mono text-ui-caption leading-relaxed"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!label.trim() || !objective.trim()}
        >
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
  onExport,
  onEdit,
  builtinEditing,
  onToggleBuiltinEdit,
  onBuiltinSaved,
}: {
  entry: AgentCatalogEntry;
  onToggle: (id: string, enabled: boolean) => void;
  onExport: (id: string) => void;
  onEdit: (id: string) => void;
  builtinEditing: boolean;
  onToggleBuiltinEdit: (id: string) => void;
  onBuiltinSaved: () => void;
}) {
  const card = entry.card;
  const custom = entry.id.startsWith("custom:");
  const editableBuiltin = !custom && entry.id in BUILTIN_ACTION_DEFAULTS;
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{card?.title ?? entry.id}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-ui-caption text-ui-muted">
              {KIND_LABEL[entry.kind]}
            </span>
            {!card?.canDisable && (
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
          <dt className="text-ui-muted">运行时机</dt>
          <dd className="m-0 text-foreground">{card.timing}</dd>
          <dt className="text-ui-muted">读取</dt>
          <dd className="m-0 text-foreground">{card.reads}</dd>
          <dt className="text-ui-muted">写入</dt>
          <dd className="m-0 text-foreground">{card.writes}</dd>
        </dl>
      )}
      {custom && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onEdit(entry.id)}
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
        </div>
      )}
      {editableBuiltin && !builtinEditing && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onToggleBuiltinEdit(entry.id)}
        >
          <PencilIcon size={14} />
          编辑
        </Button>
      )}
      {editableBuiltin && builtinEditing && (
        <BuiltinActionEditor
          id={entry.id}
          onDone={onBuiltinSaved}
          onCancel={() => onToggleBuiltinEdit(entry.id)}
        />
      )}
    </div>
  );
}

function scopeName(scope: LearningDataScope): string {
  return DATA_SCOPE_LABELS[scope].split(":")[0];
}

function hookForKind(kind: LearningAgentKind) {
  if (kind === "observer") return "conversation.observe";
  if (kind === "action") return "conversation.action";
  return null;
}

export function AgentLibraryView() {
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>(() =>
    listAgentCatalog(),
  );
  const [jobs, setJobs] = useState<AgentJob[]>([]);
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
  const [builtinEditId, setBuiltinEditId] = useState<string | null>(null);
  const [packageText, setPackageText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);

  const refreshJobs = useCallback(() => {
    void listAgentJobs(60).then(setJobs);
  }, []);

  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

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

  async function exportPackage(entryId: string) {
    setError(null);
    setMessage(null);
    try {
      const agentId = entryId.replace(/^custom:/, "");
      const text = await exportAgentPackage(agentId);
      setPackageText(text);
      setMessage("已导出到下方包文本框。");
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

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: catalog.filter((e) => e.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-1 text-ui-title font-semibold">能力库</h2>
      <p className="mt-0 mb-5 text-ui-body text-ui-muted">
        系统内置的 Agent
        能力。可以看到每个能力做什么、什么时候运行、读写什么,并启用或禁用。
        关闭一个能力只影响它自己,不会改动你的学习数据。
      </p>

      <section ref={formRef} className="mb-6 rounded-lg border bg-card p-3.5">
        <h3 className="m-0 mb-2 text-ui-body font-semibold">
          {editingId ? "编辑自定义 Agent" : "创建自定义 Agent"}
        </h3>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="1. 名称,例如: 面试表达观察"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="2. 一句话说明它做什么"
          />
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as LearningAgentKind)}
          >
            <SelectTrigger>
              <SelectValue placeholder="3. 类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="observer">观察 Agent</SelectItem>
              <SelectItem value="action">对话衍生 Agent</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={writebackPolicy}
            onValueChange={(v) =>
              setWritebackPolicy(v as LearningAgentWritebackPolicy)
            }
            disabled={kind !== "observer"}
          >
            <SelectTrigger>
              <SelectValue placeholder="4. 写入策略" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">只展示,不提议写入</SelectItem>
              <SelectItem value="propose_review_signals">
                可提议学习数据修改
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
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
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            kind === "observer"
              ? "6. Prompt: 说明每轮要观察什么、如何反馈、何时提出 memory_proposals。"
              : "6. Prompt: 说明点击按钮后要如何基于当前对话生成新的对话上下文。"
          }
          className="mt-2 min-h-28 resize-y font-mono text-ui-caption leading-relaxed"
        />
        <div className="mt-2 flex gap-2">
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
      </section>

      <div className="flex flex-col gap-5">
        {grouped.map((group) => (
          <section key={group.kind} className="flex flex-col gap-2">
            <h3 className="m-0 text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
              {KIND_LABEL[group.kind]}
            </h3>
            {group.items.map((entry) => (
              <AgentRow
                key={entry.id}
                entry={entry}
                onToggle={toggle}
                onExport={exportPackage}
                onEdit={(id) => void startEdit(id)}
                builtinEditing={builtinEditId === entry.id}
                onToggleBuiltinEdit={(id) =>
                  setBuiltinEditId((cur) => (cur === id ? null : id))
                }
                onBuiltinSaved={() => {
                  setBuiltinEditId(null);
                  setCatalog(listAgentCatalog());
                  setMessage("内置动作已更新。");
                }}
              />
            ))}
          </section>
        ))}
      </div>

      <section className="mt-6 rounded-lg border bg-card p-3.5">
        <h3 className="m-0 mb-2 text-ui-body font-semibold">Agent Package</h3>
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

      <div className="mt-8 mb-2 flex items-center gap-2">
        <h3 className="m-0 text-ui-caption font-semibold uppercase tracking-wide text-ui-muted">
          运行日志
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 px-2 text-ui-caption"
          onClick={refreshJobs}
        >
          <RefreshCwIcon size={13} />
          刷新
        </Button>
      </div>
      {jobs.length === 0 ? (
        <p className="m-0 text-ui-body text-ui-muted">还没有运行记录。</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-ui-caption"
            >
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-medium",
                  JOB_STATUS_CLASS[job.status] ?? "bg-muted text-ui-muted",
                )}
              >
                {job.status}
              </span>
              <span className="font-medium text-foreground">
                {agentIdOf(job) ?? job.kind}
              </span>
              <span className="text-ui-muted">
                {SOURCE_LABEL[job.source] ?? job.source}
              </span>
              <span className="text-ui-muted">{durationLabel(job)}</span>
              <span className="ml-auto text-ui-muted">
                {timeLabel(job.updatedAt)}
              </span>
              {job.error && (
                <span className="w-full text-destructive">{job.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
