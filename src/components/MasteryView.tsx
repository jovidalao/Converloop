import {
  CheckCircle2Icon,
  PencilIcon,
  SaveIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteMasteryItem,
  getAllMastery,
  markMasteryKnown,
  updateMasteryItem,
} from "../db/mastery";
import type { MasteryItem } from "../db/schema";
import {
  editLearningDataWithInstruction,
  MissingApiKeyError,
} from "../orchestrator";
import { useConfirm } from "./confirm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

const TYPE_LABEL: Record<string, string> = {
  vocab: "词汇",
  grammar: "语法",
  collocation: "搭配",
  error_pattern: "错误模式",
  expression_gap: "表达缺口",
};

const STATUS_LABEL: Record<string, string> = {
  struggling: "薄弱",
  learning: "学习中",
  known: "已掌握",
};

const STATUS_CLASS: Record<string, string> = {
  struggling: "bg-destructive/10 text-destructive",
  learning: "bg-warning/10 text-warning",
  known: "bg-success/10 text-success",
};

function ratio(item: MasteryItem): string {
  if (item.seenCount === 0) return "0/0";
  return `${item.errorCount}/${item.seenCount}`;
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function matches(item: MasteryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.label, item.key, item.example, item.notes]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

function Badge({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function MasteryRow({
  item,
  onRefresh,
}: {
  item: MasteryItem;
  onRefresh: () => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.label);
  const [example, setExample] = useState(item.example ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");

  async function save() {
    await updateMasteryItem(item.key, { label, example, notes });
    setEditing(false);
    onRefresh();
  }

  async function markKnown() {
    await markMasteryKnown(item.key);
    onRefresh();
  }

  async function remove() {
    if (
      !(await confirm({
        title: `删除学习项「${item.label}」?`,
        description: "事件日志会保留。",
      }))
    )
      return;
    await deleteMasteryItem(item.key);
    onRefresh();
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8 text-sm font-medium"
            />
          ) : (
            <div className="truncate text-sm font-medium">{item.label}</div>
          )}
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {item.key}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Badge className="bg-muted text-muted-foreground">
            {TYPE_LABEL[item.type] ?? item.type}
          </Badge>
          <Badge className={STATUS_CLASS[item.status] ?? "bg-muted"}>
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>错误/产出 {ratio(item)}</span>
        <span>最近 {dateLabel(item.lastSeenAt)}</span>
      </div>

      {editing ? (
        <div className="mt-3 grid gap-2">
          <Textarea
            value={example}
            onChange={(e) => setExample(e.target.value)}
            className="min-h-16 resize-none text-sm"
            placeholder="例句 / 原始表达"
          />
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-16 resize-none text-sm"
            placeholder="笔记 / 目标表达"
          />
        </div>
      ) : (
        <div className="mt-2 grid gap-1.5 text-sm leading-relaxed">
          {item.example && (
            <p className="m-0 whitespace-pre-wrap text-foreground">
              {item.example}
            </p>
          )}
          {item.notes && (
            <p className="m-0 whitespace-pre-wrap text-muted-foreground">
              {item.notes}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-0.5">
        {editing ? (
          <>
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => {
                setEditing(false);
                setLabel(item.label);
                setExample(item.example ?? "");
                setNotes(item.notes ?? "");
              }}
              title="取消"
            >
              <XIcon size={15} />
            </Button>
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => void save()}
              disabled={!label.trim()}
              title="保存"
            >
              <SaveIcon size={15} />
            </Button>
          </>
        ) : (
          <>
            {item.status !== "known" && (
              <Button
                type="button"
                variant="action"
                size="action"
                onClick={() => void markKnown()}
                title="标记已掌握"
              >
                <CheckCircle2Icon size={15} />
              </Button>
            )}
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => setEditing(true)}
              title="编辑"
            >
              <PencilIcon size={15} />
            </Button>
            <Button
              type="button"
              variant="action"
              size="action"
              onClick={() => void remove()}
              title="删除"
            >
              <Trash2Icon size={15} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function MasteryView() {
  const [items, setItems] = useState<MasteryItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [editText, setEditText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editResult, setEditResult] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await getAllMastery());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          matches(item, query) &&
          (status === "all" || item.status === status) &&
          (type === "all" || item.type === type),
      ),
    [items, query, status, type],
  );

  const types = useMemo(
    () => Array.from(new Set(items.map((item) => item.type))).sort(),
    [items],
  );

  async function applyNaturalEdit() {
    const text = editText.trim();
    if (!text || editBusy) return;
    setEditBusy(true);
    setEditResult(null);
    setEditError(null);
    try {
      const result = await editLearningDataWithInstruction(text);
      await refresh();
      setEditText("");
      const skipped = result.skipped.length
        ? ` 跳过:${result.skipped.join("、")}`
        : "";
      setEditResult(
        `${result.summary} 已执行 ${result.applied} 项。${skipped}`,
      );
    } catch (e) {
      setEditError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-3 text-lg font-semibold tracking-tight">
        学习数据
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border bg-card px-2.5">
          <SearchIcon size={15} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 key、标签、例句"
            spellCheck={false}
            className="min-w-0 flex-1 border-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border bg-card px-2 text-sm outline-none focus-visible:border-ring"
        >
          <option value="all">全部状态</option>
          <option value="struggling">薄弱</option>
          <option value="learning">学习中</option>
          <option value="known">已掌握</option>
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-9 rounded-md border bg-card px-2 text-sm outline-none focus-visible:border-ring"
        >
          <option value="all">全部类型</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid gap-2">
        {filtered.map((item) => (
          <MasteryRow
            key={item.key}
            item={item}
            onRefresh={() => void refresh()}
          />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            暂无匹配的学习项
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border bg-card p-3">
        <div className="mb-2 text-sm font-semibold">用自然语言修改数据</div>
        <Textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          placeholder="例如: 把 grammar:article_usage 标记为已掌握; 删除那个重复的 make/do 搭配; 新增一个表达缺口“委婉拒绝请求”。"
          className="min-h-24 resize-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="m-0 text-xs leading-snug text-muted-foreground">
            系统会先把请求转换成有限的数据操作,再由代码执行;不会直接修改计数。
          </p>
          <Button
            type="button"
            onClick={() => void applyNaturalEdit()}
            disabled={editBusy || !editText.trim()}
          >
            <SendIcon size={15} />
            {editBusy ? "处理中…" : "执行"}
          </Button>
        </div>
        {editResult && (
          <div className="mt-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
            {editResult}
          </div>
        )}
        {editError && (
          <div className="mt-2 rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
            {editError}
          </div>
        )}
      </div>
    </div>
  );
}
