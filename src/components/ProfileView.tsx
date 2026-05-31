import { PencilIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadConfig } from "../config";
import { runMaintainerNow } from "../profile/maintainer-runner";
import {
  ensureSections,
  type ProfileSection,
  parseProfile,
  serializeProfile,
} from "../profile/parse";
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
  "Working on": { zh: "正在练", owner: "ai" },
  "Comfortable with": { zh: "已掌握", owner: "ai" },
  "Avoids / rarely attempts": { zh: "回避 / 很少尝试", owner: "ai" },
  Interests: { zh: "兴趣", owner: "ai" },
  "Recently introduced": { zh: "最近学到", owner: "ai" },
  "My notes": { zh: "我的笔记", owner: "user" },
};

const BADGE: Record<Owner, { text: string; cls: string }> = {
  user: { text: "你的笔记 · AI 永不改动", cls: "bg-primary/10 text-primary" },
  shared: { text: "你和 AI 共同维护", cls: "bg-muted text-muted-foreground" },
  ai: { text: "AI 自动维护", cls: "bg-muted text-muted-foreground" },
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
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {zhOf(section.title)}
        {editable && (
          <PencilIcon
            size={13}
            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
      <span className={`rounded px-1.5 py-0.5 text-[0.7rem] ${badge.cls}`}>
        {badge.text}
      </span>
    </div>
  );
  const content = body ? (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {body}
    </p>
  ) : (
    <p className="text-sm text-muted-foreground">
      {editable ? "点击添加…" : "暂无"}
    </p>
  );

  if (editable) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="group block w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring hover:bg-accent/40"
      >
        {header}
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-lg border bg-card p-3">
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

// 列数随容器宽度自适应:每列目标 ~18rem,窄=1 列、宽=2/3 列。
function useColumnCount(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const minCol = 288; // 18rem
    const gap = 12; // gap-3
    const compute = () =>
      setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (minCol + gap))));
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
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
          <h3 className="text-base font-semibold">{zhOf(section.title)}</h3>
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
          className="min-h-48 flex-1 resize-none font-mono text-sm leading-normal"
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

export function ProfileView() {
  const [header, setHeader] = useState("");
  const [sections, setSections] = useState<ProfileSection[]>([]);
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState("");
  const [savedMd, setSavedMd] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load(md: string) {
    const p = ensureSections(parseProfile(md));
    setHeader(p.header);
    setSections(p.sections);
    setSavedMd(serializeProfile(p));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once load; load reads no reactive state
  useEffect(() => {
    readProfile(loadConfig()).then(load);
  }, []);

  // 当前编辑态序列化回规范 MD(标题永远齐全)。
  const currentMd = useMemo(
    () => (raw ? rawText : serializeProfile({ header, sections })),
    [raw, rawText, header, sections],
  );
  const dirty = currentMd !== savedMd;

  // 失焦/卸载自动保存(仅 raw 模式)用最新值,避免闭包读到旧 state。
  const currentMdRef = useRef("");
  currentMdRef.current = currentMd;
  const savedMdRef = useRef("");
  savedMdRef.current = savedMd;

  // 卸载时(切走档案页)冲洗未保存编辑。
  useEffect(
    () => () => {
      if (currentMdRef.current !== savedMdRef.current) {
        void writeProfile(currentMdRef.current);
      }
    },
    [],
  );

  async function saveIfDirty() {
    if (currentMdRef.current === savedMdRef.current) return;
    await writeProfile(currentMdRef.current);
    setSavedMd(currentMdRef.current);
  }

  // 编辑层保存:更新该段 → 立即落盘。
  async function saveSection(title: string, body: string) {
    const next = sections.map((s) => (s.title === title ? { ...s, body } : s));
    setSections(next);
    setEditingTitle(null);
    const md = serializeProfile({ header, sections: next });
    await writeProfile(md);
    setSavedMd(md);
    setStatus("✓ 已保存。");
  }

  function toggleRaw() {
    if (!raw) {
      setRawText(serializeProfile({ header, sections }));
      setRaw(true);
    } else {
      load(rawText);
      setRaw(false);
    }
  }

  async function save() {
    await writeProfile(currentMd);
    setSavedMd(currentMd);
    setStatus("✓ 已保存。");
  }

  async function refresh() {
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
  const colCount = useColumnCount(gridRef);
  const columns = distribute(sections, colCount);

  return (
    <div className="flex h-full max-w-5xl flex-col overflow-y-auto px-6 pt-14 pb-6">
      <h2 className="mt-0 mb-1 text-lg font-semibold tracking-tight">
        学习者档案
      </h2>
      <p className="text-sm leading-snug text-muted-foreground">
        对话 AI 读这份档案做个性化回复。点击「关于我」「我的笔记」可编辑;AI
        自动维护的几段为只读。
      </p>
      {header && (
        <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
          {header}
        </p>
      )}

      {raw ? (
        <Textarea
          aria-label="原始 Markdown"
          className="mt-3 min-h-96 max-w-2xl resize-none font-mono text-sm leading-normal"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          onBlur={() => void saveIfDirty()}
          spellCheck={false}
        />
      ) : (
        // 瀑布流:JS 把卡片分配到等宽 flex 列,各列从顶部开始 → 顶边齐平、间距统一。
        <div ref={gridRef} className="mt-3 flex items-start gap-3">
          {columns.map((col, i) => (
            <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
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
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {raw && (
          <Button onClick={save} disabled={!dirty}>
            {dirty ? "保存" : "已保存"}
          </Button>
        )}
        <Button variant="secondary" onClick={refresh} disabled={busy}>
          {busy ? "刷新中…" : "用 AI 刷新档案"}
        </Button>
        {canUndo && (
          <Button variant="ghost" size="sm" onClick={undo} disabled={busy}>
            撤销 AI 刷新
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleRaw}
          className="ml-auto"
        >
          {raw ? "返回结构化编辑" : "编辑原始 Markdown"}
        </Button>
      </div>
      {status && (
        <p
          className={`mt-2 break-words text-sm ${
            status.startsWith("✓") ? "text-primary" : "text-warning"
          }`}
        >
          {status}
        </p>
      )}

      {editingSection && (
        <EditOverlay
          section={editingSection}
          onSave={(body) => void saveSection(editingSection.title, body)}
          onCancel={() => setEditingTitle(null)}
        />
      )}
    </div>
  );
}
