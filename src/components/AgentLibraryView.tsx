import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { listAgentJobs } from "../db/agent-jobs";
import type { AgentJob } from "../db/schema";
import {
  type AgentCatalogEntry,
  type AgentKind,
  listAgentCatalog,
  setAgentEnabled,
} from "../runtime";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

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
}: {
  entry: AgentCatalogEntry;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const card = entry.card;
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
    </div>
  );
}

export function AgentLibraryView() {
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>(() =>
    listAgentCatalog(),
  );
  const [jobs, setJobs] = useState<AgentJob[]>([]);

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

      <div className="flex flex-col gap-5">
        {grouped.map((group) => (
          <section key={group.kind} className="flex flex-col gap-2">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {KIND_LABEL[group.kind]}
            </h3>
            {group.items.map((entry) => (
              <AgentRow key={entry.id} entry={entry} onToggle={toggle} />
            ))}
          </section>
        ))}
      </div>

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
