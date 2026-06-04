import {
  BookOpenCheckIcon,
  GraduationCapIcon,
  MessageSquareIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { actionShortcutLabel } from "@/lib/app-actions";
import type { ConversationMeta } from "../db/conversations";
import type { LearningAgentMeta } from "../db/learning-agents";
import { formatRelativeTime } from "./Sidebar";

// 命令面板能跳转/触发的三类目标:新建对话、开启某专项课的新一节、打开某条历史对话。
type PaletteItem =
  | { kind: "new-chat" }
  | { kind: "start-agent"; agent: LearningAgentMeta }
  | { kind: "conversation"; conv: ConversationMeta };

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationMeta[];
  learningAgents: LearningAgentMeta[];
  onSelectConversation: (id: string) => void;
  onStartLearningAgent: (agentId: string) => void;
  onNewChat: () => void;
}

function keyFor(item: PaletteItem): string {
  if (item.kind === "new-chat") return "new-chat";
  if (item.kind === "start-agent") return `agent:${item.agent.id}`;
  return `conv:${item.conv.id}`;
}

// ⌘K 命令面板:一个键盘驱动的悬浮搜索框。搜历史对话直接跳转;搜专项课时,既能
// 「开启新一节」(start-agent),也能从下方「最近对话」里点开它过往的会话——同一门
// 课的两种入口都覆盖到。Esc / 点背景关闭,↑↓ 选,↵ 确认。
export function CommandPalette({
  open,
  onClose,
  conversations,
  learningAgents,
  onSelectConversation,
  onStartLearningAgent,
  onNewChat,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 每次打开重置查询与选中项。
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: { label: string | null; items: PaletteItem[] }[] = [];

    if (!q) {
      result.push({ label: null, items: [{ kind: "new-chat" }] });
    }

    const agents = (
      q
        ? learningAgents.filter(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              a.description.toLowerCase().includes(q),
          )
        : learningAgents
    ).map((agent): PaletteItem => ({ kind: "start-agent", agent }));
    if (agents.length) result.push({ label: "定制化课程", items: agents });

    const convs = (
      q
        ? conversations.filter((c) => c.title.toLowerCase().includes(q))
        : conversations
    ).map((conv): PaletteItem => ({ kind: "conversation", conv }));
    if (convs.length) result.push({ label: "最近对话", items: convs });

    return result;
  }, [query, learningAgents, conversations]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // 查询变化后,选中项可能越界——夹回 0。
  useEffect(() => {
    setSelected((s) => (s < flat.length ? s : 0));
  }, [flat.length]);

  // 让选中行始终可见。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 选中项变化即滚动到可见,不直接引用 selected
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  function activate(item: PaletteItem) {
    if (item.kind === "new-chat") onNewChat();
    else if (item.kind === "start-agent") onStartLearningAgent(item.agent.id);
    else onSelectConversation(item.conv.id);
    onClose();
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (flat.length ? (s + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) =>
        flat.length ? (s - 1 + flat.length) % flat.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[selected];
      if (item) activate(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let flatIndex = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="快速跳转"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 仅阻止冒泡到背景关闭,非交互控件 */}
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            // biome-ignore lint/a11y/noAutofocus: 命令面板打开即应聚焦输入框
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索对话、专项课…"
            spellCheck={false}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {flat.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              没有匹配的结果
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label ?? "__default"}>
              {group.label && (
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                flatIndex += 1;
                const idx = flatIndex;
                const isSelected = idx === selected;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘导航统一由输入框处理(activedescendant 模式)
                  // biome-ignore lint/a11y/useFocusableInteractive: option 不单独获焦,焦点留在输入框
                  <div
                    key={keyFor(item)}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    className="mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-accent"
                    onMouseMove={() => setSelected(idx)}
                    onClick={() => activate(item)}
                  >
                    <PaletteRow item={item} />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PaletteRow({ item }: { item: PaletteItem }) {
  if (item.kind === "new-chat") {
    return (
      <>
        <SquarePenIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">新对话</span>
        <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground/80">
          {actionShortcutLabel("new-chat")}
        </kbd>
      </>
    );
  }
  if (item.kind === "start-agent") {
    return (
      <>
        <GraduationCapIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{item.agent.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          开启新一节
        </span>
      </>
    );
  }
  return (
    <>
      {item.conv.kind === "learning_agent" ? (
        <BookOpenCheckIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{item.conv.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelativeTime(item.conv.updatedAt)}
      </span>
    </>
  );
}
