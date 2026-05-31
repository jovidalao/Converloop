import { WandSparklesIcon } from "lucide-react";
import { useState } from "react";
import {
  DATA_SCOPE_LABELS,
  LEARNING_DATA_SCOPES,
  type LearningDataScope,
} from "../db/learning-agents";
import {
  createCustomLearningAgentFromDescription,
  MissingApiKeyError,
} from "../orchestrator";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface LearningAgentsViewProps {
  onRefresh: () => Promise<void>;
}

function scopeName(scope: LearningDataScope): string {
  return DATA_SCOPE_LABELS[scope].split(":")[0];
}

export function LearningAgentsView({ onRefresh }: LearningAgentsViewProps) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    const text = request.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await createCustomLearningAgentFromDescription(text);
      setRequest("");
      await onRefresh();
      setMessage(
        "已创建专项课。它已加入左侧「定制化学习」,可直接开始或在那里编辑。",
      );
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

  return (
    <div className="flex h-full max-w-4xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-2 text-lg font-semibold tracking-tight">
        创建专项课
      </h2>
      <p className="mt-0 mb-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        「专项课」会新开一个对话,使用老师型 system prompt,可以用母语讲解,
        也可以用目标语言出练习。创建后会出现在左侧「定制化学习」里,在那里开始或编辑。
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

      <div className="mt-4 rounded-lg border bg-card p-3">
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
          className="mt-2"
          onClick={() => void generate()}
          disabled={busy || !request.trim()}
        >
          <WandSparklesIcon size={15} />
          {busy ? "创建中…" : "自动创建"}
        </Button>
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
