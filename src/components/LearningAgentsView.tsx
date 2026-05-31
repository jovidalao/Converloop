import { PlayIcon, SaveIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DATA_SCOPE_LABELS,
  deleteLearningAgent,
  LEARNING_DATA_SCOPES,
  type LearningAgentMeta,
  type LearningDataScope,
  updateLearningAgent,
} from "../db/learning-agents";
import {
  createCustomLearningAgentFromDescription,
  MissingApiKeyError,
} from "../orchestrator";
import { useConfirm } from "./confirm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

interface LearningAgentsViewProps {
  agents: LearningAgentMeta[];
  onRefresh: () => Promise<void>;
  onStart: (agentId: string) => void;
}

function scopeName(scope: LearningDataScope): string {
  return DATA_SCOPE_LABELS[scope].split(":")[0];
}

export function LearningAgentsView({
  agents,
  onRefresh,
  onStart,
}: LearningAgentsViewProps) {
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(
    agents[0]?.id ?? null,
  );
  const selected = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? agents[0] ?? null,
    [agents, selectedId],
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scopes, setScopes] = useState<LearningDataScope[]>([]);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setName(selected.name);
    setDescription(selected.description);
    setPrompt(selected.prompt);
    setScopes(selected.dataScopes);
  }, [selected]);

  function toggleScope(scope: LearningDataScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function generate() {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const id = await createCustomLearningAgentFromDescription(text);
      setRequest("");
      setSelectedId(id);
      await onRefresh();
      setMessage("已创建专项课。你可以继续微调 prompt,或直接开始。");
    } catch (e) {
      setError(
        e instanceof MissingApiKeyError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateLearningAgent(selected.id, {
        name,
        description,
        prompt,
        dataScopes: scopes,
      });
      await onRefresh();
      setMessage("已保存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected || selected.builtIn) return;
    if (
      !(await confirm({
        title: `删除专项课「${selected.name}」?`,
        description: "已有会话不会被删除。",
      }))
    )
      return;
    await deleteLearningAgent(selected.id);
    await onRefresh();
    setSelectedId(null);
  }

  return (
    <div className="flex h-full max-w-6xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-2 text-lg font-semibold tracking-tight">
        定制化学习 Agent
      </h2>
      <p className="mt-0 mb-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        这类会话叫「专项课」: 它会新开一个对话,使用老师型 system prompt,
        可以用母语讲解,也可以用目标语言出练习。
      </p>

      <div className="grid gap-2 border-y py-3 md:grid-cols-2">
        {LEARNING_DATA_SCOPES.map((scope) => (
          <div key={scope} className="text-sm leading-snug">
            <span className="font-medium text-foreground">
              {scopeName(scope)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              {DATA_SCOPE_LABELS[scope].replace(`${scopeName(scope)}:`, "")}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-2 text-sm font-semibold">自然语言创建</div>
            <Textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="例如: 帮我创建一个专门练商务邮件开头和结尾的老师,根据我的表达缺口出题。"
              className="min-h-24 resize-none"
            />
            <Button
              type="button"
              size="sm"
              className="mt-2 w-full"
              onClick={() => void generate()}
              disabled={busy || !request.trim()}
            >
              <WandSparklesIcon size={15} />
              {busy ? "创建中…" : "自动创建"}
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`rounded-md px-2.5 py-2 text-left text-sm ${
                  selected?.id === agent.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60"
                }`}
                onClick={() => setSelectedId(agent.id)}
              >
                <span className="block truncate font-medium">{agent.name}</span>
                <span className="block truncate text-xs opacity-80">
                  {agent.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        {selected && (
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Prompt 微调</div>
                <div className="text-xs text-muted-foreground">
                  {selected.builtIn ? "内置专项课" : "自定义专项课"}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onStart(selected.id)}
                >
                  <PlayIcon size={15} />
                  开始
                </Button>
                {!selected.builtIn && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    onClick={() => void remove()}
                    title="删除"
                  >
                    <Trash2Icon size={15} />
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {LEARNING_DATA_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={`rounded-md border px-2 py-1 text-xs ${
                      scopes.includes(scope)
                        ? "border-primary bg-primary/10 text-primary"
                        : "bg-background text-muted-foreground"
                    }`}
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
                className="min-h-72 resize-y font-mono text-xs leading-relaxed"
              />
              <Button
                type="button"
                className="w-fit"
                onClick={() => void save()}
                disabled={saving || !name.trim() || !prompt.trim()}
              >
                <SaveIcon size={15} />
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        )}
      </div>

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
    </div>
  );
}
