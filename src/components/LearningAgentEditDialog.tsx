import { SaveIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DATA_SCOPE_LABELS,
  LEARNING_DATA_SCOPES,
  type LearningAgentDraft,
  type LearningAgentMeta,
  type LearningDataScope,
} from "../db/learning-agents";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

function scopeName(scope: LearningDataScope): string {
  return DATA_SCOPE_LABELS[scope].split(":")[0];
}

// 编辑层(悬浮窗):从侧栏某节专项课的「编辑」打开,微调名称/数据范围/prompt。Esc 关闭。
export function LearningAgentEditDialog({
  agent,
  onSave,
  onCancel,
}: {
  agent: LearningAgentMeta;
  onSave: (patch: Partial<LearningAgentDraft>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [prompt, setPrompt] = useState(agent.prompt);
  const [scopes, setScopes] = useState<LearningDataScope[]>(agent.dataScopes);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function toggleScope(scope: LearningDataScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`编辑专项课 ${agent.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onCancel}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 仅阻止冒泡到背景关闭,非交互控件 */}
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border bg-card p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-ui-title font-semibold">编辑专项课</h3>
            <div className="text-ui-caption text-ui-muted">
              {agent.builtIn ? "内置专项课" : "自定义专项课"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCancel}
            aria-label="关闭"
          >
            <XIcon size={16} />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto">
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
                className={`rounded-md border px-2 py-1 text-ui-caption ${
                  scopes.includes(scope)
                    ? "border-border bg-accent text-foreground"
                    : "bg-background text-foreground-80"
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
            className="min-h-72 resize-y font-mono text-ui-caption leading-relaxed"
          />
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSave({ name, description, prompt, dataScopes: scopes })
            }
            disabled={!name.trim() || !prompt.trim()}
          >
            <SaveIcon size={15} />
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
