import {
  DownloadIcon,
  PlusIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  LEARNING_DATA_SCOPES,
  type LearningAgentKind,
  type LearningAgentWritebackPolicy,
  type LearningDataScope,
} from "../db/learning-agents";
import type { AgentJob } from "../db/schema";
import {
  type AgentCatalogEntry,
  type AgentKind,
  listAgentCatalog,
  reloadCustomRuntimeAgents,
  setAgentEnabled,
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
  action: "动作",
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
  pending: "bg-muted text-muted-foreground",
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

function AgentRow({
  entry,
  onToggle,
  onExport,
}: {
  entry: AgentCatalogEntry;
  onToggle: (id: string, enabled: boolean) => void;
  onExport: (id: string) => void;
}) {
  const card = entry.card;
  const custom = entry.id.startsWith("custom:");
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{card?.title ?? entry.id}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {KIND_LABEL[entry.kind]}
            </span>
            {!card?.canDisable && (
              <span className="text-xs text-muted-foreground">常驻</span>
            )}
          </div>
          {card?.description && (
            <p className="mt-1 mb-0 text-sm leading-snug text-muted-foreground">
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
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">运行时机</dt>
          <dd className="m-0 text-foreground">{card.timing}</dd>
          <dt className="text-muted-foreground">读取</dt>
          <dd className="m-0 text-foreground">{card.reads}</dd>
          <dt className="text-muted-foreground">写入</dt>
          <dd className="m-0 text-foreground">{card.writes}</dd>
        </dl>
      )}
      {custom && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onExport(entry.id)}
        >
          <DownloadIcon size={14} />
          导出包
        </Button>
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
  const [packageText, setPackageText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function createCustomAgent() {
    if (!name.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
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
      setName("");
      setDescription("");
      setPrompt("");
      await refreshCatalog();
      setMessage("自定义 Agent 已创建并启用。");
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
      <h2 className="mt-0 mb-1 text-lg font-semibold">能力库</h2>
      <p className="mt-0 mb-5 text-sm text-muted-foreground">
        系统内置的 Agent
        能力。可以看到每个能力做什么、什么时候运行、读写什么,并启用或禁用。
        关闭一个能力只影响它自己,不会改动你的学习数据。
      </p>

      <section className="mb-6 rounded-lg border bg-card p-3.5">
        <h3 className="m-0 mb-2 text-sm font-semibold">创建自定义 Agent</h3>
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
              <SelectItem value="action">动作 Agent</SelectItem>
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
                "rounded-md border px-2 py-1 text-xs",
                scopes.includes(scope)
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-background text-muted-foreground",
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
              : "6. Prompt: 说明点击按钮后要生成怎样的分支指令。"
          }
          className="mt-2 min-h-28 resize-y font-mono text-xs leading-relaxed"
        />
        <Button
          type="button"
          size="sm"
          className="mt-2"
          onClick={() => void createCustomAgent()}
          disabled={busy || !name.trim() || !prompt.trim()}
        >
          <PlusIcon size={14} />
          创建并启用
        </Button>
      </section>

      <div className="flex flex-col gap-5">
        {grouped.map((group) => (
          <section key={group.kind} className="flex flex-col gap-2">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[group.kind]}
            </h3>
            {group.items.map((entry) => (
              <AgentRow
                key={entry.id}
                entry={entry}
                onToggle={toggle}
                onExport={exportPackage}
              />
            ))}
          </section>
        ))}
      </div>

      <section className="mt-6 rounded-lg border bg-card p-3.5">
        <h3 className="m-0 mb-2 text-sm font-semibold">Agent Package</h3>
        <Textarea
          value={packageText}
          onChange={(e) => setPackageText(e.target.value)}
          placeholder="粘贴 lang-agent.agent-package JSON;导出包也会出现在这里。"
          className="min-h-32 resize-y font-mono text-xs leading-relaxed"
        />
        {packageReview && (
          <div className="mt-2 rounded-md bg-muted px-2.5 py-2 text-xs leading-relaxed">
            <div className="font-medium">{packageReview.name}</div>
            <div className="text-muted-foreground">
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
        <div className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-8 mb-2 flex items-center gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          运行日志
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 px-2 text-xs"
          onClick={refreshJobs}
        >
          <RefreshCwIcon size={13} />
          刷新
        </Button>
      </div>
      {jobs.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">还没有运行记录。</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs"
            >
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-medium",
                  JOB_STATUS_CLASS[job.status] ??
                    "bg-muted text-muted-foreground",
                )}
              >
                {job.status}
              </span>
              <span className="font-medium text-foreground">
                {agentIdOf(job) ?? job.kind}
              </span>
              <span className="text-muted-foreground">
                {SOURCE_LABEL[job.source] ?? job.source}
              </span>
              <span className="text-muted-foreground">
                {durationLabel(job)}
              </span>
              <span className="ml-auto text-muted-foreground/80">
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
