import {
  ChevronDownIcon,
  DownloadIcon,
  ListChecksIcon,
  UploadIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportAgentPackage,
  importAgentPackage,
  reviewAgentPackage,
} from "../agent-package";
import {
  DATA_SCOPE_LABELS,
  LEARNING_DATA_SCOPES,
  type LearningAgentMeta,
  type LearningDataScope,
  listLearningAgents,
} from "../db/learning-agents";
import {
  type LearningProject,
  listLearningProjects,
} from "../db/learning-projects";
import {
  createCustomLearningAgentFromDescription,
  createLearningProjectFromGoal,
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
  const [lessonRequest, setLessonRequest] = useState("");
  const [lessonBusy, setLessonBusy] = useState(false);
  const [projectRequest, setProjectRequest] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);
  const [projects, setProjects] = useState<LearningProject[]>([]);
  const [lessons, setLessons] = useState<LearningAgentMeta[]>([]);
  const [packageText, setPackageText] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLocalItems = useCallback(
    () =>
      Promise.all([listLearningProjects(), listLearningAgents()]).then(
        ([projectRows, lessonRows]) => {
          setProjects(projectRows);
          setLessons(lessonRows);
        },
      ),
    [],
  );

  useEffect(() => {
    void refreshLocalItems();
  }, [refreshLocalItems]);

  function reportError(e: unknown) {
    setError(
      e instanceof MissingApiKeyError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e),
    );
  }

  async function generateProject() {
    const text = projectRequest.trim();
    if (!text || projectBusy) return;
    setProjectBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createLearningProjectFromGoal(text);
      setProjectRequest("");
      await refreshLocalItems();
      await onRefresh();
      setMessage(
        `已创建学习项目,并生成 ${result.createdLearningAgentIds.length} 个专项课。`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      setProjectBusy(false);
    }
  }

  async function generateLesson() {
    const text = lessonRequest.trim();
    if (!text || lessonBusy) return;
    setLessonBusy(true);
    setError(null);
    setMessage(null);
    try {
      await createCustomLearningAgentFromDescription(text);
      setLessonRequest("");
      await refreshLocalItems();
      await onRefresh();
      setMessage(
        "已创建专项课。它已加入左侧「定制化学习」,可直接开始或在那里编辑。",
      );
    } catch (e) {
      reportError(e);
    } finally {
      setLessonBusy(false);
    }
  }

  async function exportLessonPackage(agentId: string) {
    setError(null);
    setMessage(null);
    try {
      const text = await exportAgentPackage(agentId);
      setPackageText(text);
      setPackageOpen(true);
      setMessage("已导出到下方「导入/导出」里的包文本框。");
    } catch (e) {
      reportError(e);
    }
  }

  async function importPackage() {
    if (!packageText.trim() || packageBusy) return;
    setPackageBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await importAgentPackage(packageText, {
        enableRuntimeAgents: true,
        enableLessons: true,
      });
      await refreshLocalItems();
      await onRefresh();
      setMessage(
        `包已导入: ${result.lessonCount} 个专项课、${result.runtimeSkillCount} 个技能。`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      setPackageBusy(false);
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

  const customLessons = lessons.filter((lesson) => !lesson.builtIn);

  return (
    <div className="flex h-full max-w-4xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-2 text-ui-title font-semibold tracking-tight">
        创建专项课
      </h2>
      <p className="mt-0 mb-3 max-w-3xl text-ui-body leading-relaxed text-ui-muted">
        「专项课」会新开一个对话,使用老师型 system prompt,可以用母语讲解,
        也可以用目标语言出练习。创建后会出现在左侧「定制化学习」里,在那里开始或编辑。
      </p>

      <div className="grid gap-2 border-y py-3 md:grid-cols-2">
        {LEARNING_DATA_SCOPES.map((scope) => (
          <div key={scope} className="text-ui-body leading-snug">
            <span className="font-medium text-foreground">
              {scopeName(scope)}
            </span>
            <span className="text-ui-muted">
              {" "}
              {DATA_SCOPE_LABELS[scope].replace(`${scopeName(scope)}:`, "")}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border bg-card p-3">
        <div className="mb-2 text-ui-body font-semibold">学习项目</div>
        <Textarea
          value={projectRequest}
          onChange={(e) => setProjectRequest(e.target.value)}
          placeholder="例如: 我下个月要英语面试前端岗位,帮我做一个练习计划。"
          className="min-h-24 resize-none"
        />
        <Button
          type="button"
          size="sm"
          className="mt-2"
          onClick={() => void generateProject()}
          disabled={projectBusy || !projectRequest.trim()}
        >
          <ListChecksIcon size={15} />
          {projectBusy ? "规划中…" : "生成项目"}
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="mt-4 border-y py-3">
          <div className="mb-2 text-ui-body font-semibold">已有学习项目</div>
          <div className="grid gap-2">
            {projects.map((project) => (
              <div key={project.id} className="text-ui-body leading-snug">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {project.title}
                  </span>
                  <span className="rounded border px-1.5 py-0.5 text-ui-caption text-ui-muted">
                    {project.status}
                  </span>
                </div>
                <div className="mt-1 text-ui-muted">{project.goal}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="mt-4 rounded-lg border bg-card">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3.5 py-3 text-ui-body font-semibold"
          onClick={() => setPackageOpen((v) => !v)}
        >
          <ChevronDownIcon
            size={15}
            className={packageOpen ? "rotate-180 transition-transform" : ""}
          />
          专项课导入/导出
        </button>
        {packageOpen && (
          <div className="border-t px-3.5 py-3">
            <div className="mb-2 text-ui-caption text-ui-muted">
              分享包只包含
              prompt、权限和课程结构,不包含你的学习数据、对话历史或密钥。
            </div>
            {customLessons.length > 0 && (
              <div className="mb-3 grid gap-1.5">
                {customLessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-ui-body font-medium">
                        {lesson.name}
                      </div>
                      <div className="truncate text-ui-caption text-ui-muted">
                        {lesson.description}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void exportLessonPackage(lesson.id)}
                    >
                      <DownloadIcon size={14} />
                      导出
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Textarea
              value={packageText}
              onChange={(e) => setPackageText(e.target.value)}
              placeholder="粘贴 lang-agent.package JSON。导出包也会出现在这里。"
              className="min-h-32 resize-y font-mono text-ui-caption leading-relaxed"
            />
            {packageReview && (
              <div className="mt-2 rounded-md bg-muted px-2.5 py-2 text-ui-caption leading-relaxed">
                <div className="font-medium">{packageReview.name}</div>
                <div className="text-ui-muted">
                  {packageReview.itemSummary} · 读取: {packageReview.reads} ·
                  写入: {packageReview.writes}
                </div>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void importPackage()}
              disabled={packageBusy || !packageText.trim() || !packageReview}
            >
              <UploadIcon size={14} />
              {packageBusy ? "导入中…" : "导入包"}
            </Button>
          </div>
        )}
      </section>

      <div className="mt-4 rounded-lg border bg-card p-3">
        <div className="mb-2 text-ui-body font-semibold">自然语言创建</div>
        <Textarea
          value={lessonRequest}
          onChange={(e) => setLessonRequest(e.target.value)}
          placeholder="例如: 帮我创建一个专门练商务邮件开头和结尾的老师,根据我的表达缺口出题。"
          className="min-h-24 resize-none"
        />
        <Button
          type="button"
          size="sm"
          className="mt-2"
          onClick={() => void generateLesson()}
          disabled={lessonBusy || !lessonRequest.trim()}
        >
          <WandSparklesIcon size={15} />
          {lessonBusy ? "创建中…" : "自动创建"}
        </Button>
      </div>

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
