import {
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  LanguagesIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useConfig } from "../config";
import {
  deriveSignals,
  type MasteryType,
  type SignalKind,
} from "../db/mastery-logic";
import {
  applyMemoryProposal,
  dismissMemoryProposal,
  listPendingMemoryProposals,
  memoryProposalOperations,
} from "../db/memory-proposals";
import type { MemoryProposal, TurnAnnotation } from "../db/schema";
import { listTurnAnnotations } from "../db/turn-annotations";
import type { ChatTurn } from "../db/turns";
import {
  CATEGORY_LABEL,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
} from "./InlineCorrection";
import { Markdown } from "./Markdown";
import type { MainView } from "./Sidebar";
import { SpeakableText } from "./SpeakButton";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

// 教练面板:把散在气泡里的批改 + 系统「记下了什么」收拢到右栏,常驻可见。
// Phase 2 与气泡内反馈并存(见 docs/agent-runtime-plan.md);只展示,不改发送/记账逻辑。

const SIGNAL_LABEL: Record<SignalKind, string> = {
  error: "记为出错",
  correct: "用对了",
  introduced: "新引入",
  gap: "表达缺口",
};

const SIGNAL_TONE: Record<SignalKind, string> = {
  error: "bg-destructive/10 text-destructive",
  correct: "bg-success/10 text-success",
  introduced: "bg-muted text-muted-foreground",
  gap: "bg-accent text-primary",
};

const TYPE_LABEL: Record<MasteryType, string> = {
  vocab: "词汇",
  grammar: "语法",
  collocation: "搭配",
  error_pattern: "错误模式",
  expression_gap: "表达缺口",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

// 本轮反馈:批改中 / 纯文本降级 / 表达缺口 / 结构化纠错。
function TurnFeedback({
  turn,
  nativeLanguage,
}: {
  turn: ChatTurn;
  nativeLanguage: string;
}) {
  const { analysis } = turn;

  if (turn.analysisPending && !analysis && !turn.analysisProse) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Spinner />
        正在批改本轮…
      </span>
    );
  }

  if (!analysis && turn.analysisProse?.trim()) {
    return (
      <pre className="m-0 whitespace-pre-wrap break-words rounded-lg border bg-card p-3 font-sans text-sm leading-relaxed text-foreground">
        {turn.analysisProse.trim()}
      </pre>
    );
  }

  if (!analysis) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        {turn.analysisError ?? "本轮暂无批改。"}
      </p>
    );
  }

  // 母语/混说轮:讲解构句思路,没有目标语原句可 diff。
  const gap = analysis.expression_gap;
  if (gap) {
    return (
      <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 text-sm leading-normal shadow-sm">
        <FieldLabel icon={<LanguagesIcon size={12} />}>
          {nativeLanguage.trim() || "母语"}原句
        </FieldLabel>
        <p className="m-0 text-muted-foreground">{gap.original}</p>
        <FieldLabel>地道表达</FieldLabel>
        <SpeakableText text={gap.target_expression} />
        <FieldLabel>讲解</FieldLabel>
        <p className="m-0 leading-relaxed text-foreground">{gap.explanation}</p>
        {gap.key_items.length > 0 && (
          <>
            <FieldLabel>关键词 / 句式</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {gap.key_items.map((it, i) => (
                <span
                  key={i}
                  className="inline-flex items-baseline gap-1.5 rounded-md border bg-background px-2 py-1"
                  title={it.gloss}
                >
                  <span className="font-semibold text-foreground">
                    {it.text}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {it.gloss}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
        {gap.usage_note?.trim() && (
          <p className="m-0 text-sm leading-snug text-muted-foreground">
            {gap.usage_note.trim()}
          </p>
        )}
      </div>
    );
  }

  const hasIssues = analysis.issues.length > 0;
  const corrected = analysis.corrected?.trim();
  const natural = analysis.natural?.trim();
  const showCorrected = !!corrected && corrected !== turn.userText.trim();
  const showNatural = !!natural && natural !== corrected;

  if (!hasIssues && !showCorrected && !showNatural) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-success">
        <CheckIcon size={15} />
        表达准确,无需修改。
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-sm leading-normal shadow-sm">
      {showCorrected && (
        <div className="flex flex-col gap-1">
          <FieldLabel>修改后</FieldLabel>
          <SpeakableText text={corrected} />
        </div>
      )}
      {showNatural && (
        <div className="flex flex-col gap-1">
          <FieldLabel>更自然的说法</FieldLabel>
          <SpeakableText text={natural} />
        </div>
      )}
      {hasIssues && (
        <ul className="m-0 flex list-none flex-col p-0">
          {analysis.issues.map((iss, i) => (
            <li
              key={i}
              className="border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-primary">
                  {CATEGORY_LABEL[iss.category]}
                </span>
                <span
                  className={cn(
                    "text-xs uppercase",
                    SEVERITY_COLOR[iss.severity],
                  )}
                >
                  {SEVERITY_LABEL[iss.severity]}
                </span>
              </div>
              <p className="m-0">
                <del className="text-destructive line-through decoration-destructive">
                  {iss.span_original}
                </del>
                <span
                  className="mx-1.5 text-xs text-muted-foreground"
                  aria-hidden
                >
                  →
                </span>
                <ins className="font-medium text-success no-underline">
                  {iss.span_corrected}
                </ins>
              </p>
              <p className="mt-1.5 mb-0 text-sm leading-snug text-muted-foreground">
                {iss.explanation}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldLabel({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </span>
  );
}

// 本轮学习记忆:从批改派生出代码即将记账的信号(与 deriveSignals 同源,无竞态)。
// 这是「凡是写入学习记忆的事情,用户都应该看得见」(验收 #6)的核心。
function TurnMemory({ turn }: { turn: ChatTurn }) {
  if (!turn.analysis) return null;
  const signals = deriveSignals(turn.analysis);
  if (signals.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        本轮没有新增学习记录。
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {signals.map((s) => (
        <li
          key={`${s.kind}:${s.key}`}
          className="flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2"
        >
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {TYPE_LABEL[s.type]}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {s.label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold",
                SIGNAL_TONE[s.kind],
              )}
            >
              {SIGNAL_LABEL[s.kind]}
            </span>
          </div>
          {s.example?.trim() && (
            <p
              className="m-0 truncate text-xs text-muted-foreground"
              title={s.example}
            >
              {s.example.trim()}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function CustomObservations({ items }: { items: TurnAnnotation[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border bg-card p-3 text-sm">
          <div className="mb-1.5 font-semibold">{item.title}</div>
          <Markdown className="text-sm leading-relaxed">{item.bodyMd}</Markdown>
        </li>
      ))}
    </ul>
  );
}

function MemoryProposals({
  items,
  onChanged,
}: {
  items: MemoryProposal[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function apply(id: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const result = await applyMemoryProposal(id);
      setMessage(`已应用 ${result.applied} 条。`);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    setMessage(null);
    try {
      await dismissMemoryProposal(id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        没有待确认的写入建议。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const ops = memoryProposalOperations(item);
        return (
          <div key={item.id} className="rounded-lg border bg-card p-3 text-sm">
            <div className="font-semibold">{item.summary}</div>
            <ul className="my-2 flex list-none flex-col gap-1 p-0 text-xs text-muted-foreground">
              {ops.map((op, i) => (
                <li key={`${op.action}:${op.key}:${i}`}>
                  {op.action} · {op.key}
                  {op.label ? ` · ${op.label}` : ""}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busyId === item.id}
                onClick={() => void apply(item.id)}
              >
                确认写入
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busyId === item.id}
                onClick={() => void dismiss(item.id)}
              >
                忽略
              </Button>
            </div>
          </div>
        );
      })}
      {message && <p className="m-0 text-xs text-success">{message}</p>}
    </div>
  );
}

export function CoachPanel({
  turn,
  onOpenView,
}: {
  turn: ChatTurn | null;
  onOpenView?: (view: MainView) => void;
}) {
  const { nativeLanguage } = useConfig();
  const [annotations, setAnnotations] = useState<TurnAnnotation[]>([]);
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);

  const refreshExtras = useCallback(() => {
    const turnId = turn?.id;
    if (!turnId) {
      setAnnotations([]);
      setProposals([]);
      return;
    }
    void Promise.all([
      listTurnAnnotations(turnId),
      listPendingMemoryProposals(turnId),
    ]).then(([nextAnnotations, nextProposals]) => {
      setAnnotations(nextAnnotations);
      setProposals(nextProposals);
    });
  }, [turn?.id]);

  useEffect(() => {
    refreshExtras();
    if (!turn?.id) return;
    const timer = window.setInterval(refreshExtras, 1500);
    return () => window.clearInterval(timer);
  }, [turn?.id, refreshExtras]);

  return (
    <div className="codex-coach-content flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-4 py-3">
        <BrainIcon size={15} className="text-muted-foreground" />
        <span className="text-sm font-semibold">学习教练</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {!turn ? (
          <p className="m-auto max-w-[34ch] text-center text-sm leading-relaxed text-muted-foreground">
            发送一句话后,这里会显示本轮批改,以及系统为你记下的学习内容。
          </p>
        ) : (
          <>
            <Section title="本轮反馈">
              <TurnFeedback turn={turn} nativeLanguage={nativeLanguage} />
            </Section>
            <Section title="本轮学习记忆">
              <TurnMemory turn={turn} />
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => onOpenView?.("mastery")}
              >
                查看全部学习数据
                <ArrowRightIcon size={12} />
              </button>
            </Section>
            {annotations.length > 0 && (
              <Section title="自定义观察">
                <CustomObservations items={annotations} />
              </Section>
            )}
            <Section title="待确认记忆">
              <MemoryProposals items={proposals} onChanged={refreshExtras} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
