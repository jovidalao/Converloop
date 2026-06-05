import {
  FileTextIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadConfig } from "../config";
import { applyProfilePreferenceInstruction } from "../orchestrator";
import { runMaintainerNow } from "../profile/maintainer-runner";
import {
  ensureSections,
  type ProfileSection,
  parseProfile,
  serializeProfile,
} from "../profile/parse";
import {
  isPreferenceSection,
  PREFERENCE_SCOPE_LABEL,
  type PreferenceScope,
  type ProfilePreferences,
  preferencesFromProfile,
  updateProfilePreference,
} from "../profile/preferences";
import {
  readProfile,
  restoreProfile,
  snapshotProfile,
  writeProfile,
} from "../profile/profile";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type Owner = "user" | "shared" | "ai";

// 段 → 中文标题 + 归属。归属决定徽章、提示语,以及是否可编辑(ai = 只读)。
const SECTION_META: Record<string, { zh: string; owner: Owner }> = {
  "About me": { zh: "关于我", owner: "shared" },
  "AI preferences": { zh: "AI 自定义", owner: "user" },
  "Working on": { zh: "正在练", owner: "ai" },
  "Comfortable with": { zh: "已掌握", owner: "ai" },
  "Avoids / rarely attempts": { zh: "回避 / 很少尝试", owner: "ai" },
  Interests: { zh: "兴趣", owner: "ai" },
  "Recently introduced": { zh: "最近学到", owner: "ai" },
  "Expression gaps": { zh: "想说但说不出", owner: "ai" },
  "My notes": { zh: "我的笔记", owner: "user" },
};

const BADGE: Record<Owner, { text: string; cls: string }> = {
  user: { text: "你的笔记 · AI 永不改动", cls: "bg-primary/10 text-primary" },
  shared: { text: "你和 AI 共同维护", cls: "bg-muted text-ui-muted" },
  ai: { text: "AI 自动维护", cls: "bg-muted text-ui-muted" },
};

function ownerOf(title: string): Owner {
  return SECTION_META[title]?.owner ?? "ai";
}
function zhOf(title: string): string {
  return SECTION_META[title]?.zh ?? title;
}
// 可编辑 = 用户拥有/共管;AI 自动维护的段只读、不可点击。
function isEditable(title: string): boolean {
  return ownerOf(title) !== "ai";
}

// My notes 正文里去掉占位 HTML 注释,只显示用户真正写的内容。
function displayBody(s: ProfileSection): string {
  if (s.title !== "My notes") return s.body;
  return s.body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function normalizeProfileMd(md: string): string {
  return serializeProfile(ensureSections(parseProfile(md)));
}

const PREFERENCE_FIELDS: Array<{
  scope: PreferenceScope;
  placeholder: string;
}> = [
  {
    scope: "global",
    placeholder: "适用于所有模块,例如: 使用澳大利亚英语; 默认简洁一点",
  },
  {
    scope: "conversation",
    placeholder: "只影响普通聊天,例如: 多问开放式问题; 回复不要太长",
  },
  {
    scope: "tutor",
    placeholder: "只影响批改,例如: 我经常语音输入,忽略纯大小写和标点问题",
  },
  {
    scope: "learning",
    placeholder: "只影响专项课,例如: 先诊断再练习; 每次只练一个点",
  },
  {
    scope: "reading",
    placeholder: "只影响阅读辅助,例如: 翻译更口语化; 解释习语时多给语境",
  },
];

function PreferencesPanel({
  preferences,
  smartDraft,
  smartBusy,
  onSmartDraftChange,
  onSmartApply,
  onScopeChange,
  onScopeBlur,
}: {
  preferences: ProfilePreferences;
  smartDraft: string;
  smartBusy: boolean;
  onSmartDraftChange: (value: string) => void;
  onSmartApply: () => void;
  onScopeChange: (scope: PreferenceScope, value: string) => void;
  onScopeBlur: () => void;
}) {
  return (
    <section className="rounded-md border border-border/70 bg-card/80 p-4 shadow-minimal-flat">
      <div className="mb-4 flex flex-col gap-2">
        <div>
          <h3 className="m-0 text-ui-body font-semibold">AI 自定义</h3>
          <p className="m-0 mt-1 text-ui-body leading-snug text-ui-muted">
            用自然语言描述偏好,系统会把它写进档案并分发到对应模块。
          </p>
        </div>
        <span className="w-fit rounded bg-primary/10 px-1.5 py-0.5 text-ui-caption text-primary">
          你的设置 · AI 维护档案时保留
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Textarea
          aria-label="一句话描述 AI 自定义"
          className="min-h-28 resize-y bg-background/60 text-ui-body leading-normal"
          value={smartDraft}
          onChange={(e) => onSmartDraftChange(e.target.value)}
          placeholder="例如: 对话用澳大利亚日常英语; 我经常用语音输入,批改时不要纠结大小写和标点; 讲解时多用中文类比。"
        />
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onSmartApply}
            disabled={smartBusy || !smartDraft.trim()}
            className="w-full"
          >
            <SparklesIcon size={15} />
            {smartBusy ? "归类中…" : "让 AI 归类保存"}
          </Button>
        </div>
      </div>

      <details className="mt-4">
        <summary className="text-ui-body font-medium text-ui-muted">
          按模块微调
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {PREFERENCE_FIELDS.map((field) => (
            <div key={field.scope} className="flex flex-col gap-1.5">
              <span className="text-ui-body text-ui-muted">
                {PREFERENCE_SCOPE_LABEL[field.scope]}
              </span>
              <Textarea
                aria-label={PREFERENCE_SCOPE_LABEL[field.scope]}
                className="min-h-24 resize-y bg-background/60 text-ui-body leading-normal"
                value={preferences[field.scope]}
                onChange={(e) => onScopeChange(field.scope, e.target.value)}
                onBlur={onScopeBlur}
                placeholder={field.placeholder}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

// 只读卡片:完整显示内容,卡片高度随内容自适应,内部无滚动条。
// 可编辑的卡片整张可点击 → 打开编辑层;只读的不可点、无悬停反馈。
function SectionCard({
  section,
  onEdit,
}: {
  section: ProfileSection;
  onEdit?: () => void;
}) {
  const owner = ownerOf(section.title);
  const badge = BADGE[owner];
  const body = displayBody(section);
  const editable = !!onEdit;

  const header = (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-ui-body font-semibold">
        {zhOf(section.title)}
        {editable && (
          <PencilIcon
            size={13}
            className="shrink-0 text-ui-muted opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-ui-caption ${badge.cls}`}
      >
        {badge.text}
      </span>
    </div>
  );
  const content = body ? (
    <p className="m-0 whitespace-pre-wrap text-ui-body leading-relaxed text-foreground">
      {body}
    </p>
  ) : (
    <p className="m-0 text-ui-body text-ui-muted">
      {editable ? "点击添加…" : "暂无"}
    </p>
  );

  if (editable) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="group block w-full rounded-md border border-border/70 bg-card/80 p-4 text-left shadow-minimal-flat transition-colors hover:border-ring hover:bg-accent/40"
      >
        {header}
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-md border border-border/70 bg-card/80 p-4 shadow-minimal-flat">
      {header}
      {content}
    </div>
  );
}

// 把卡片分配到 n 列(贪心:每张放进当前最矮的列),近似瀑布流均衡。
// 各列都是从顶部开始的 flex-col,顶边天然齐平、间距统一。
function distribute(sections: ProfileSection[], n: number): ProfileSection[][] {
  const cols: ProfileSection[][] = Array.from({ length: n }, () => []);
  const heights = new Array(n).fill(0);
  for (const s of sections) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].push(s);
    heights[i] += displayBody(s).length + 60; // 60 ≈ 标题/内边距的基础高度
  }
  return cols;
}

// 列数随容器宽度自适应:窄=1 列、宽=2/3 列,最多 3 列避免读起来碎。
function useColumnCount(
  ref: React.RefObject<HTMLDivElement | null>,
  active: boolean,
): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const minCol = 300;
    const gap = 16;
    const compute = () =>
      setCols(
        Math.min(
          3,
          Math.max(1, Math.floor((el.clientWidth + gap) / (minCol + gap))),
        ),
      );
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return cols;
}

// 编辑层(悬浮窗):点开某段后在此编辑,保存/取消。Esc 关闭。
function EditOverlay({
  section,
  onSave,
  onCancel,
}: {
  section: ProfileSection;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(displayBody(section));
  const owner = ownerOf(section.title);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`编辑 ${zhOf(section.title)}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onCancel}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 仅阻止冒泡到背景关闭,非交互控件 */}
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-card p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-ui-title font-semibold">{zhOf(section.title)}</h3>
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
        <Textarea
          autoFocus
          aria-label={zhOf(section.title)}
          className="min-h-48 flex-1 resize-none font-mono text-ui-body leading-normal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            owner === "user"
              ? "写点想让 AI 记住的:提醒、长期偏好、关于你的事实…(AI 不会改动这里)"
              : "每行一条"
          }
          spellCheck={false}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onSave(draft)}>保存</Button>
        </div>
      </div>
    </div>
  );
}

function ProfileActions({
  raw,
  dirty,
  loaded,
  busy,
  canUndo,
  status,
  onSave,
  onRefresh,
  onUndo,
  onToggleRaw,
}: {
  raw: boolean;
  dirty: boolean;
  loaded: boolean;
  busy: boolean;
  canUndo: boolean;
  status: string | null;
  onSave: () => void;
  onRefresh: () => void;
  onUndo: () => void;
  onToggleRaw: () => void;
}) {
  return (
    <section className="rounded-md border border-border/70 bg-card/80 p-4 shadow-minimal-flat">
      <div className="mb-3">
        <h3 className="m-0 text-ui-body font-semibold">维护</h3>
        <p className="m-0 mt-1 text-ui-body leading-snug text-ui-muted">
          手动刷新、撤销和原始 Markdown 编辑。
        </p>
      </div>
      <div className="grid gap-2">
        {raw && (
          <Button
            type="button"
            onClick={onSave}
            disabled={!dirty}
            className="justify-start"
          >
            <SaveIcon size={15} />
            {dirty ? "保存 Markdown" : "已保存"}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={onRefresh}
          disabled={busy || !loaded}
          className="justify-start"
        >
          <RefreshCwIcon size={15} />
          {busy ? "刷新中…" : "用 AI 刷新档案"}
        </Button>
        {canUndo && (
          <Button
            type="button"
            variant="ghost"
            onClick={onUndo}
            disabled={busy}
            className="justify-start"
          >
            <RotateCcwIcon size={15} />
            撤销 AI 刷新
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={onToggleRaw}
          disabled={!loaded}
          className="justify-start"
        >
          <FileTextIcon size={15} />
          {raw ? "返回结构化编辑" : "编辑原始 Markdown"}
        </Button>
      </div>
      {status && (
        <p
          className={`mt-3 break-words text-ui-body ${
            status.startsWith("✓") ? "text-primary" : "text-warning"
          }`}
        >
          {status}
        </p>
      )}
    </section>
  );
}

export function ProfileView() {
  const [header, setHeader] = useState("");
  const [sections, setSections] = useState<ProfileSection[]>([]);
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  const [savedMd, setSavedMd] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [smartDraft, setSmartDraft] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback((md: string) => {
    const p = ensureSections(parseProfile(md));
    setHeader(p.header);
    setSections(p.sections);
    setSavedMd(serializeProfile(p));
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    readProfile(loadConfig()).then((md) => {
      if (alive) load(md);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // 当前编辑态序列化回规范 MD(标题永远齐全)。
  const currentMd = useMemo(
    () =>
      loaded ? (raw ? rawText : serializeProfile({ header, sections })) : "",
    [loaded, raw, rawText, header, sections],
  );
  const dirty = loaded && currentMd !== savedMd;
  const preferences = useMemo(
    () => preferencesFromProfile(currentMd || ""),
    [currentMd],
  );

  // 失焦/卸载自动保存、文件同步都用最新值,避免闭包读到旧 state。
  const currentMdRef = useRef("");
  currentMdRef.current = currentMd;
  const savedMdRef = useRef("");
  savedMdRef.current = savedMd;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const rawRef = useRef(false);
  rawRef.current = raw;
  const editingRef = useRef(false);
  editingRef.current = editingTitle !== null;

  useEffect(() => {
    let alive = true;

    async function syncFromDisk() {
      if (!loadedRef.current) return;
      if (dirtyRef.current || busyRef.current || editingRef.current) return;
      try {
        const md = await readProfile(loadConfig());
        if (!alive) return;
        const normalized = normalizeProfileMd(md);
        if (normalized === savedMdRef.current) return;

        if (rawRef.current) {
          setRawText(normalized);
          setSavedMd(normalized);
        } else {
          load(md);
        }
      } catch (e) {
        console.warn("同步档案失败:", e);
      }
    }

    const onFocus = () => void syncFromDisk();
    const onVisibility = () => {
      if (!document.hidden) void syncFromDisk();
    };
    const interval = window.setInterval(() => void syncFromDisk(), 2000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  // 卸载时(切走档案页)冲洗未保存编辑。
  useEffect(
    () => () => {
      if (loadedRef.current && currentMdRef.current !== savedMdRef.current) {
        void writeProfile(currentMdRef.current);
      }
    },
    [],
  );

  async function saveIfDirty() {
    if (!loaded) return;
    if (currentMdRef.current === savedMdRef.current) return;
    await writeProfile(currentMdRef.current);
    setSavedMd(currentMdRef.current);
  }

  // 编辑层保存:更新该段 → 立即落盘。
  async function saveSection(title: string, body: string) {
    if (!loaded) return;
    const next = sections.map((s) => (s.title === title ? { ...s, body } : s));
    setSections(next);
    setEditingTitle(null);
    const md = serializeProfile({ header, sections: next });
    await writeProfile(md);
    setSavedMd(md);
    setStatus("✓ 已保存。");
  }

  function applyProfileMdToState(md: string) {
    if (raw) {
      setRawText(md);
      setSavedMd(md);
    } else {
      load(md);
    }
  }

  function updatePreference(scope: PreferenceScope, body: string) {
    if (!loaded || raw) return;
    const md = updateProfilePreference(currentMd, scope, body);
    const p = ensureSections(parseProfile(md));
    setHeader(p.header);
    setSections(p.sections);
  }

  async function applySmartPreference() {
    const instruction = smartDraft.trim();
    if (!loaded || !instruction) return;
    setSmartBusy(true);
    setStatus("AI 正在判断这条自定义应该放到哪个模块…");
    try {
      await writeProfile(currentMd);
      const next = await applyProfilePreferenceInstruction(
        instruction,
        currentMd,
      );
      await writeProfile(next);
      applyProfileMdToState(next);
      setSmartDraft("");
      setStatus("✓ 已归类并保存到档案。");
    } catch (e) {
      setStatus(`归类失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSmartBusy(false);
    }
  }

  function toggleRaw() {
    if (!loaded) return;
    if (!raw) {
      setRawText(serializeProfile({ header, sections }));
      setRaw(true);
    } else {
      load(rawText);
      setRaw(false);
    }
  }

  async function save() {
    if (!loaded) return;
    await writeProfile(currentMd);
    setSavedMd(currentMd);
    setStatus("✓ 已保存。");
  }

  async function refresh() {
    if (!loaded) return;
    setBusy(true);
    setStatus("AI 正在根据掌握数据 + 近期对话刷新档案…");
    try {
      await writeProfile(currentMd); // 先落盘当前编辑
      setSavedMd(currentMd);
      await snapshotProfile(); // 快照到 .bak,供「撤销」
      const r = await runMaintainerNow();
      if (r.written && r.profile) {
        if (raw) {
          setRawText(r.profile);
          setSavedMd(r.profile);
        } else {
          load(r.profile);
        }
        setCanUndo(true);
        setStatus("✓ 档案已更新(通过 sanity check)。");
      } else {
        setStatus(`未更新:${r.reason}`);
      }
    } catch (e) {
      setStatus(`刷新失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const restored = await restoreProfile();
    if (restored == null) {
      setStatus("没有可恢复的版本。");
      return;
    }
    if (raw) {
      setRawText(restored);
      setSavedMd(restored);
    } else {
      load(restored);
    }
    setCanUndo(false);
    setStatus("✓ 已恢复到 AI 刷新前的版本。");
  }

  const editingSection = sections.find((s) => s.title === editingTitle) ?? null;

  const gridRef = useRef<HTMLDivElement>(null);
  const colCount = useColumnCount(gridRef, loaded && !raw);
  const displaySections = sections.filter(
    (section) => !isPreferenceSection(section),
  );
  const columns = distribute(displaySections, colCount);

  return (
    <div className="h-full overflow-y-auto px-6 py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <h2 className="m-0 text-ui-title font-semibold tracking-tight">
              学习者档案
            </h2>
            <p className="m-0 mt-2 text-ui-body leading-relaxed text-ui-muted">
              对话 AI 会读这份档案做个性化回复。你可以在这里写自定义体验;AI
              自动维护的学习状态为只读。
            </p>
            {header && (
              <p className="m-0 mt-3 truncate font-mono text-ui-caption text-ui-muted">
                {header}
              </p>
            )}
          </div>
        </header>

        {!loaded ? (
          <p className="m-0 text-ui-body text-ui-muted">加载档案…</p>
        ) : raw ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Textarea
              aria-label="原始 Markdown"
              className="min-h-[calc(100vh-260px)] resize-none bg-background/60 font-mono text-ui-body leading-normal"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              onBlur={() => void saveIfDirty()}
              spellCheck={false}
            />
            <ProfileActions
              raw={raw}
              dirty={dirty}
              loaded={loaded}
              busy={busy}
              canUndo={canUndo}
              status={status}
              onSave={() => void save()}
              onRefresh={() => void refresh()}
              onUndo={() => void undo()}
              onToggleRaw={toggleRaw}
            />
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <main className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="m-0 text-ui-body font-semibold">档案条目</h3>
                <span className="text-ui-caption text-ui-muted">
                  {displaySections.length} 个模块
                </span>
              </div>
              {/* 瀑布流:JS 把卡片分配到等宽 flex 列,各列从顶部开始 → 顶边齐平、间距统一。 */}
              <div ref={gridRef} className="flex items-start gap-4">
                {columns.map((col, i) => (
                  <div key={i} className="flex min-w-0 flex-1 flex-col gap-4">
                    {col.map((s) => (
                      <SectionCard
                        key={s.title}
                        section={s}
                        onEdit={
                          isEditable(s.title)
                            ? () => setEditingTitle(s.title)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>
            </main>
            <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
              <PreferencesPanel
                preferences={preferences}
                smartDraft={smartDraft}
                smartBusy={smartBusy}
                onSmartDraftChange={setSmartDraft}
                onSmartApply={() => void applySmartPreference()}
                onScopeChange={updatePreference}
                onScopeBlur={() => void saveIfDirty()}
              />
              <ProfileActions
                raw={raw}
                dirty={dirty}
                loaded={loaded}
                busy={busy}
                canUndo={canUndo}
                status={status}
                onSave={() => void save()}
                onRefresh={() => void refresh()}
                onUndo={() => void undo()}
                onToggleRaw={toggleRaw}
              />
            </aside>
          </div>
        )}

        {editingSection && (
          <EditOverlay
            section={editingSection}
            onSave={(body) => void saveSection(editingSection.title, body)}
            onCancel={() => setEditingTitle(null)}
          />
        )}
      </div>
    </div>
  );
}
