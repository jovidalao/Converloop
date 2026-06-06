import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  type AgentJobSource,
  type AgentJobStatus,
  countAgentJobs,
  listAgentJobsPage,
} from "../db/agent-jobs";
import type { AgentJob } from "../db/schema";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

// Settings · Logs page: every agent run (conversation / task planning / profile
// maintenance / summary / manual) lands in the agent_job table; here you filter
// by source/status and page through it. Regular users see "what ran, whether it
// succeeded or failed, and how long it took".

const PAGE_SIZE = 25;

const STATUS_CLASS: Record<AgentJobStatus, string> = {
  succeeded: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  running: "bg-warning/10 text-warning",
  pending: "bg-muted text-ui-muted",
};

const SOURCE_VALUES: AgentJobSource[] = [
  "conversation",
  "task_agent",
  "maintainer",
  "summary",
  "manual",
];
const STATUS_VALUES: AgentJobStatus[] = [
  "succeeded",
  "failed",
  "running",
  "pending",
];

const ALL = "all";

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

export function LogsView() {
  const { t } = useTranslation();
  const [source, setSource] = useState<AgentJobSource | typeof ALL>(ALL);
  const [status, setStatus] = useState<AgentJobStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(0);
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const filter = useCallback(
    () => ({
      source: source === ALL ? undefined : source,
      status: status === ALL ? undefined : status,
    }),
    [source, status],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = filter();
      const [rows, count] = await Promise.all([
        listAgentJobsPage({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, ...f }),
        countAgentJobs(f),
      ]);
      setJobs(rows);
      setTotal(count);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Return to the first page when the filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset the page when the filters change
  useEffect(() => {
    setPage(0);
  }, [source, status]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page + 1 < pageCount;

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-1 text-ui-title font-semibold">
        {t("logs.title")}
      </h2>
      <p className="mt-0 mb-4 text-ui-body text-ui-muted">
        {t("logs.description")}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          value={source}
          onValueChange={(v) => setSource(v as AgentJobSource | typeof ALL)}
        >
          <SelectTrigger className="h-8 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("logs.allSources")}</SelectItem>
            {SOURCE_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`logs.source.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as AgentJobStatus | typeof ALL)}
        >
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("logs.allStatuses")}</SelectItem>
            {STATUS_VALUES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`logs.status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-2 text-ui-caption"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCwIcon size={13} />
          {t("logs.refresh")}
        </Button>
      </div>

      {jobs.length === 0 ? (
        <p className="m-0 text-ui-body text-ui-muted">
          {loading ? t("common.loading") : t("logs.empty")}
        </p>
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
                  STATUS_CLASS[job.status],
                )}
              >
                {t(`logs.status.${job.status}`)}
              </span>
              <span className="font-medium text-foreground">
                {agentIdOf(job) ?? job.kind}
              </span>
              <span className="text-ui-muted">{job.kind}</span>
              <span className="text-ui-muted">
                {t(`logs.source.${job.source}`)}
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

      <div className="mt-4 flex items-center gap-3 text-ui-caption text-ui-muted">
        <span>
          {t("logs.pageInfo", {
            page: total === 0 ? 0 : page + 1,
            pages: pageCount,
            total,
          })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2"
            disabled={!hasPrev || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeftIcon size={14} />
            {t("logs.prev")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2"
            disabled={!hasNext || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("logs.next")}
            <ChevronRightIcon size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
