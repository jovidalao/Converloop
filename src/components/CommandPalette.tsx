import {
  BookOpenCheckIcon,
  GraduationCapIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  MicIcon,
  SearchIcon,
  SquarePenIcon,
  TargetIcon,
  ZapIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Locale, type TFunction, useTranslation } from "@/i18n";
import { actionShortcutLabel } from "@/lib/app-actions";
import { useModalFocus } from "@/lib/modal-focus";
import { type ConversationMeta, conversationType } from "../db/conversations";
import type { LearningAgentMeta } from "../db/learning-agents";
import { formatRelativeTime } from "./Sidebar";

// Type badge for a past-conversation row, mirroring the sidebar history icons
// so each kind (plain chat / rapid Q&A / dictation / custom learning) reads the
// same in both surfaces.
function conversationIcon(c: ConversationMeta) {
  const cls = "size-4 shrink-0 text-ui-muted";
  switch (conversationType(c)) {
    case "learning_agent":
      return <BookOpenCheckIcon className={cls} />;
    case "quickfire":
      return <ZapIcon className={cls} />;
    case "dictation":
      return <HeadphonesIcon className={cls} />;
    case "shadowing":
      return <MicIcon className={cls} />;
    case "review_drill":
      return <TargetIcon className={cls} />;
    default:
      return <MessageSquareIcon className={cls} />;
  }
}

// Practice-mode launchers: every drill the sidebar can start is also reachable
// from the palette, so a keyboard-first session never needs the mouse.
type PaletteMode = "quickfire" | "dictation" | "shadowing" | "review-drill";

const MODE_ICONS: Record<PaletteMode, typeof ZapIcon> = {
  quickfire: ZapIcon,
  dictation: HeadphonesIcon,
  shadowing: MicIcon,
  "review-drill": TargetIcon,
};

// The kinds of targets the command palette can jump to / trigger: start a new
// chat, launch a practice mode (drill), start a new session of a lesson, or
// open a past conversation.
type PaletteItem =
  | { kind: "new-chat" }
  | { kind: "mode"; mode: PaletteMode; label: string }
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
  onStartQuickfire: () => void;
  onStartDictation: () => void;
  onStartShadowing: () => void;
  onStartReviewDrill: () => void;
}

function keyFor(item: PaletteItem): string {
  if (item.kind === "new-chat") return "new-chat";
  if (item.kind === "mode") return `mode:${item.mode}`;
  if (item.kind === "start-agent") return `agent:${item.agent.id}`;
  return `conv:${item.conv.id}`;
}

// ⌘K command palette: a keyboard-driven floating search box. Searching past
// conversations jumps straight to them; searching lessons lets you either
// "start a new session" (start-agent) or open one of its past conversations
// from the "Recent conversations" group below — both entry points to the same
// lesson are covered. Esc / clicking the backdrop closes; ↑↓ select, ↵ confirm.
export function CommandPalette({
  open,
  onClose,
  conversations,
  learningAgents,
  onSelectConversation,
  onStartLearningAgent,
  onNewChat,
  onStartQuickfire,
  onStartDictation,
  onStartShadowing,
  onStartReviewDrill,
}: CommandPaletteProps) {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionBaseId = useId();
  useModalFocus({
    open,
    dialogRef,
    initialFocusRef: inputRef,
    onClose,
  });

  // Reset the query and selection each time it opens.
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

    // Practice-mode launchers: always listed when idle; filtered by their
    // localized names when searching.
    const modeDefs: { mode: PaletteMode; label: string }[] = [
      { mode: "quickfire", label: t("sidebar.quickfire") },
      { mode: "dictation", label: t("sidebar.dictation") },
      { mode: "shadowing", label: t("sidebar.shadowing") },
      { mode: "review-drill", label: t("sidebar.reviewDrill") },
    ];
    const modes = (
      q ? modeDefs.filter((m) => m.label.toLowerCase().includes(q)) : modeDefs
    ).map((m): PaletteItem => ({ kind: "mode", mode: m.mode, label: m.label }));
    if (modes.length)
      result.push({
        label: t("commandPalette.practiceModes"),
        items: modes,
      });

    const agents = (
      q
        ? learningAgents.filter(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              a.description.toLowerCase().includes(q),
          )
        : learningAgents
    ).map((agent): PaletteItem => ({ kind: "start-agent", agent }));
    if (agents.length)
      result.push({ label: t("commandPalette.customLessons"), items: agents });

    const convs = (
      q
        ? conversations.filter((c) => c.title.toLowerCase().includes(q))
        : conversations
    ).map((conv): PaletteItem => ({ kind: "conversation", conv }));
    if (convs.length)
      result.push({
        label: t("commandPalette.recentConversations"),
        items: convs,
      });

    return result;
  }, [query, learningAgents, conversations, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // After the query changes the selection may be out of range — clamp to 0.
  useEffect(() => {
    setSelected((s) => (s < flat.length ? s : 0));
  }, [flat.length]);

  // Keep the selected row in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll into view whenever the selection changes; `selected` isn't referenced directly
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  function activate(item: PaletteItem) {
    if (item.kind === "new-chat") onNewChat();
    else if (item.kind === "mode") {
      if (item.mode === "quickfire") onStartQuickfire();
      else if (item.mode === "dictation") onStartDictation();
      else if (item.mode === "shadowing") onStartShadowing();
      else onStartReviewDrill();
    } else if (item.kind === "start-agent") onStartLearningAgent(item.agent.id);
    else onSelectConversation(item.conv.id);
    onClose();
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    // Don't intercept navigation/activation keys while an IME is composing —
    // arrows move through candidates and Enter confirms one; only act once the
    // composition has committed (search-by-Chinese must not fire on candidate Enter).
    if (e.nativeEvent.isComposing) return;
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
      aria-label={t("commandPalette.ariaLabel")}
      data-modal-overlay
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops propagation to the backdrop-close handler; not an interactive control */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-ui-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("commandPalette.searchPlaceholder")}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              flat.length > 0 ? `${optionBaseId}-${selected}` : undefined
            }
            className="h-12 flex-1 bg-transparent text-ui-body outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {flat.length === 0 && (
            <div className="px-3 py-6 text-center text-ui-body text-ui-muted">
              {t("commandPalette.noResults")}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label ?? "__default"}>
              {group.label && (
                <div className="px-3 pt-2 pb-1 text-ui-caption font-medium uppercase tracking-wide text-ui-muted">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                flatIndex += 1;
                const idx = flatIndex;
                const isSelected = idx === selected;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation is handled entirely by the input (activedescendant pattern)
                  // biome-ignore lint/a11y/useFocusableInteractive: options aren't individually focused; focus stays in the input
                  <div
                    id={`${optionBaseId}-${idx}`}
                    key={keyFor(item)}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected}
                    className="mx-1 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-ui-body data-[selected=true]:bg-accent"
                    onMouseMove={() => setSelected(idx)}
                    onClick={() => activate(item)}
                  >
                    <PaletteRow item={item} t={t} locale={locale} />
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

function PaletteRow({
  item,
  t,
  locale,
}: {
  item: PaletteItem;
  t: TFunction;
  locale: Locale;
}) {
  if (item.kind === "new-chat") {
    return (
      <>
        <SquarePenIcon className="size-4 shrink-0 text-ui-muted" />
        <span className="min-w-0 flex-1 truncate">
          {t("commandPalette.newChat")}
        </span>
        <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
          {actionShortcutLabel("new-chat")}
        </kbd>
      </>
    );
  }
  if (item.kind === "mode") {
    const Icon = MODE_ICONS[item.mode];
    return (
      <>
        <Icon className="size-4 shrink-0 text-ui-muted" />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </>
    );
  }
  if (item.kind === "start-agent") {
    return (
      <>
        <GraduationCapIcon className="size-4 shrink-0 text-ui-muted" />
        <span className="min-w-0 flex-1 truncate">{item.agent.name}</span>
        <span className="shrink-0 text-ui-caption text-ui-muted">
          {t("commandPalette.startNewSession")}
        </span>
      </>
    );
  }
  return (
    <>
      {conversationIcon(item.conv)}
      <span className="min-w-0 flex-1 truncate">{item.conv.title}</span>
      <span className="shrink-0 text-ui-caption text-ui-muted">
        {formatRelativeTime(item.conv.updatedAt, locale)}
      </span>
    </>
  );
}
