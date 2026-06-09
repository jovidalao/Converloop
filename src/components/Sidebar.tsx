import {
  ArrowLeftIcon,
  BlocksIcon,
  BookOpenCheckIcon,
  BotIcon,
  ChevronRightIcon,
  HeadphonesIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PencilIcon,
  PencilRulerIcon,
  ScrollTextIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquarePenIcon,
  SquareSlashIcon,
  Trash2Icon,
  TrophyIcon,
  UserRoundIcon,
  Volume2Icon,
  ZapIcon,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";
import { type Locale, staticT, useTranslation } from "@/i18n";
import { actionAriaKeyshortcuts, actionShortcutLabel } from "@/lib/app-actions";
import { type ConversationMeta, conversationType } from "../db/conversations";
import { getActions, isAgentEnabled } from "../runtime";
import { useConfirm } from "./confirm";
import { EntityRow, EntityRowAction } from "./EntityRow";

export type MainView =
  | "chat"
  | "profile"
  | "mastery"
  | "records"
  | "learning"
  | "learning-gallery"
  | "design"
  | "agents"
  | "settings-logs"
  | "settings-general"
  | "settings-llm"
  | "settings-tts"
  | "settings-commands"
  | "settings-customize";

// Relative time: "just now" within the first minute, then stepping up through
// minutes → hours → days → weeks → months → years. Number/unit wording is
// localized via Intl.RelativeTimeFormat.
export function formatRelativeTime(ts: number, locale: Locale): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return staticT("sidebar.justNow");
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hour = Math.floor(min / 60);
  if (hour < 24) return rtf.format(-hour, "hour");
  const day = Math.floor(hour / 24);
  if (day < 7) return rtf.format(-day, "day");
  const week = Math.floor(day / 7);
  if (day < 30) return rtf.format(-week, "week");
  const month = Math.floor(day / 30);
  if (month < 12) return rtf.format(-month, "month");
  return rtf.format(-Math.floor(day / 365), "year");
}

// Type badge shown on each history row so the conversation kind (plain chat /
// rapid Q&A / dictation / custom learning) is scannable at a glance. Mirrors
// the icons used on the sidebar entries that start each kind.
function conversationTypeIcon(c: ConversationMeta): ReactNode {
  switch (conversationType(c)) {
    case "learning_agent":
      return <BookOpenCheckIcon className="size-3.5 shrink-0" />;
    case "quickfire":
      return <ZapIcon className="size-3.5 shrink-0" />;
    case "dictation":
      return <HeadphonesIcon className="size-3.5 shrink-0" />;
    default:
      return <MessageSquareIcon className="size-3.5 shrink-0" />;
  }
}

interface SidebarProps {
  conversations: ConversationMeta[];
  activeId: string;
  newChatActive: boolean;
  /** The current draft is a Rapid Q&A start page (highlights the quickfire entry). */
  quickfireActive: boolean;
  /** The current draft is a dictation start page (highlights the dictation entry). */
  dictationActive: boolean;
  view: MainView;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onStartQuickfire: () => void;
  onStartDictation: () => void;
  onDeriveConversation: (conversationId: string, actionId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenView: (view: MainView) => void;
  /** Sidebar is drilled into the settings sub-menu (derived from the active view). */
  settingsMode: boolean;
  /** Leave the settings sub-menu and return to the conversation list / chat. */
  onExitSettings: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function Sidebar({
  conversations,
  activeId,
  newChatActive,
  quickfireActive,
  dictationActive,
  view,
  onSelect,
  onNewChat,
  onStartQuickfire,
  onStartDictation,
  onDeriveConversation,
  onRename,
  onDelete,
  onOpenView,
  settingsMode,
  onExitSettings,
  width,
  onResize,
  onResizeStart,
  onResizeEnd,
}: SidebarProps) {
  const confirm = useConfirm();
  const { t, locale } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [conversationMenu, setConversationMenu] = useState<{
    conv: ConversationMeta;
    x: number;
    y: number;
  } | null>(null);

  const derivationActions = getActions("session").filter((a) =>
    isAgentEnabled(a.id),
  );

  useEffect(() => {
    if (!conversationMenu) return;
    function close() {
      setConversationMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [conversationMenu]);

  // Right-click: open the derivation menu at the cursor (rename/delete stay on
  // the inline buttons, so they're not duplicated here).
  function openConversationMenu(e: ReactMouseEvent, c: ConversationMeta) {
    if (c.kind !== "practice" || derivationActions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setConversationMenu({
      conv: c,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 276)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 320)),
    });
  }

  // "Derive" button: the same menu reachable via keyboard/trackpad, anchored
  // just below the button.
  function openMenuFromButton(e: ReactMouseEvent, c: ConversationMeta) {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setConversationMenu({
      conv: c,
      x: Math.max(8, Math.min(r.right - 256, window.innerWidth - 276)),
      y: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 320)),
    });
  }

  function startEdit(c: ConversationMeta) {
    setEditingId(c.id);
    setDraft(c.title);
  }

  function commitEdit() {
    if (editingId) {
      const t = draft.trim();
      if (t) onRename(editingId, t);
    }
    setEditingId(null);
  }

  function startResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let frame = 0;
    let nextWidth = startWidth;

    function flushResize() {
      frame = 0;
      onResize(nextWidth);
    }

    function onMove(ev: PointerEvent) {
      nextWidth = startWidth + ev.clientX - startX;
      if (!frame) frame = requestAnimationFrame(flushResize);
    }

    function finishResize() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        onResize(nextWidth);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    }

    onResizeStart?.();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  // A row in the settings sub-menu: same .codex-sidebar-action style as the
  // "New chat" / "Settings" entries, with the selected state driven by data-active.
  const renderSettingsItem = (v: MainView, icon: ReactNode, label: string) => (
    <button
      key={v}
      type="button"
      className="codex-sidebar-action"
      data-active={view === v}
      onClick={() => onOpenView(v)}
    >
      <span className="codex-sidebar-leading-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <aside className="codex-sidebar" tabIndex={-1}>
      <div className="codex-sidebar-content">
        <div
          className="codex-sidebar-track"
          data-mode={settingsMode ? "settings" : "main"}
        >
          {/* Pane 1: conversation inbox. Slides out and goes inert when
              drilled into settings. */}
          <div className="codex-sidebar-pane" inert={settingsMode || undefined}>
            <div className="codex-sidebar-actions">
              <button
                type="button"
                className="codex-sidebar-action group"
                data-active={newChatActive}
                onClick={onNewChat}
                title={t("sidebar.newChatTooltip", {
                  shortcut: actionShortcutLabel("new-chat"),
                })}
                aria-keyshortcuts={actionAriaKeyshortcuts("new-chat")}
              >
                <span className="codex-sidebar-leading-icon">
                  <SquarePenIcon className="size-4" />
                </span>
                <span>{t("sidebar.newChat")}</span>
                <kbd className="ml-auto rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted opacity-0 transition-opacity group-hover:opacity-100">
                  {actionShortcutLabel("new-chat")}
                </kbd>
              </button>
              <button
                type="button"
                className="codex-sidebar-action"
                data-active={quickfireActive}
                onClick={onStartQuickfire}
                title={t("sidebar.quickfireTooltip")}
              >
                <span className="codex-sidebar-leading-icon">
                  <ZapIcon className="size-4" />
                </span>
                <span>{t("sidebar.quickfire")}</span>
              </button>
              <button
                type="button"
                className="codex-sidebar-action"
                data-active={dictationActive}
                onClick={onStartDictation}
                title={t("sidebar.dictationTooltip")}
              >
                <span className="codex-sidebar-leading-icon">
                  <HeadphonesIcon className="size-4" />
                </span>
                <span>{t("sidebar.dictation")}</span>
              </button>
              <button
                type="button"
                className="codex-sidebar-action"
                data-active={view === "learning-gallery"}
                onClick={() => onOpenView("learning-gallery")}
                title={t("sidebar.customLearningTooltip")}
              >
                <span className="codex-sidebar-leading-icon">
                  <BookOpenCheckIcon className="size-4" />
                </span>
                <span>{t("sidebar.customLearning")}</span>
              </button>
            </div>

            <nav className="codex-sidebar-scroll">
              <div className="codex-section-label">{t("sidebar.recent")}</div>
              {conversations.map((c) => {
                const active = view === "chat" && c.id === activeId;
                if (editingId === c.id) {
                  return (
                    <input
                      key={c.id}
                      className="codex-sidebar-edit"
                      value={draft}
                      // biome-ignore lint/a11y/noAutofocus: user-triggered inline rename — focus the field as it opens
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  );
                }
                return (
                  <EntityRow
                    key={c.id}
                    active={active}
                    icon={conversationTypeIcon(c)}
                    title={c.title}
                    meta={formatRelativeTime(c.updatedAt, locale)}
                    onSelect={() => onSelect(c.id)}
                    onContextMenu={(e) => openConversationMenu(e, c)}
                    onDoubleClick={() => startEdit(c)}
                    actions={
                      <>
                        <EntityRowAction
                          label={t("common.rename")}
                          icon={<PencilIcon className="size-3.5" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(c);
                          }}
                        />
                        <EntityRowAction
                          label={t("common.delete")}
                          icon={<Trash2Icon className="size-3.5" />}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (
                              await confirm({
                                title: t("sidebar.deleteConversationTitle", {
                                  title: c.title,
                                }),
                                description: t(
                                  "sidebar.deleteConversationDescription",
                                ),
                              })
                            ) {
                              onDelete(c.id);
                            }
                          }}
                        />
                        {c.kind === "practice" &&
                          derivationActions.length > 0 && (
                            <EntityRowAction
                              label={t("sidebar.deriveNewConversation")}
                              icon={<SparklesIcon className="size-3.5" />}
                              onClick={(e) => openMenuFromButton(e, c)}
                            />
                          )}
                      </>
                    }
                  />
                );
              })}
              {conversations.length === 0 && (
                <div className="px-3 py-2 text-ui-body text-[color:var(--codex-sidebar-muted)]">
                  {t("sidebar.noConversations")}
                </div>
              )}
            </nav>

            <div className="codex-sidebar-footer">
              <button
                type="button"
                className="codex-sidebar-action group"
                onClick={() => onOpenView("settings-general")}
                title={t("sidebar.settingsTooltip", {
                  shortcut: actionShortcutLabel("settings"),
                })}
                aria-label={t("sidebar.settings")}
              >
                <span className="codex-sidebar-leading-icon">
                  <SettingsIcon size={17} />
                </span>
                <span>{t("sidebar.settings")}</span>
                <ChevronRightIcon className="ml-auto size-4 text-ui-muted transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>

          {/* Pane 2: settings sub-menu. Slides out and goes inert when
              drilled back out. */}
          <div
            className="codex-sidebar-pane"
            inert={!settingsMode || undefined}
          >
            <nav className="codex-sidebar-scroll">
              <div className="codex-section-label">
                {t("sidebar.sectionSettings")}
              </div>
              {renderSettingsItem(
                "settings-general",
                <SlidersHorizontalIcon className="size-4" />,
                t("sidebar.general"),
              )}
              {renderSettingsItem(
                "settings-customize",
                <SparklesIcon className="size-4" />,
                t("sidebar.customization"),
              )}
              {renderSettingsItem(
                "settings-llm",
                <BotIcon className="size-4" />,
                t("sidebar.llmProviders"),
              )}
              {renderSettingsItem(
                "settings-tts",
                <Volume2Icon className="size-4" />,
                t("sidebar.ttsProviders"),
              )}
              {renderSettingsItem(
                "settings-commands",
                <SquareSlashIcon className="size-4" />,
                t("sidebar.slashCommands"),
              )}

              <div className="codex-section-label">
                {t("sidebar.sectionProfileDatabase")}
              </div>
              {renderSettingsItem(
                "records",
                <TrophyIcon className="size-4" />,
                t("sidebar.achievements"),
              )}
              {renderSettingsItem(
                "design",
                <PencilRulerIcon className="size-4" />,
                t("sidebar.designNotes"),
              )}
              {renderSettingsItem(
                "mastery",
                <ListChecksIcon className="size-4" />,
                t("sidebar.data"),
              )}
              {renderSettingsItem(
                "agents",
                <BlocksIcon className="size-4" />,
                t("sidebar.capabilities"),
              )}
              {renderSettingsItem(
                "settings-logs",
                <ScrollTextIcon className="size-4" />,
                t("sidebar.logs"),
              )}
              {renderSettingsItem(
                "profile",
                <UserRoundIcon className="size-4" />,
                t("sidebar.profile"),
              )}
            </nav>

            <div className="codex-sidebar-footer">
              <button
                type="button"
                className="codex-sidebar-action group"
                onClick={onExitSettings}
                aria-label={t("sidebar.back")}
              >
                <span className="codex-sidebar-leading-icon">
                  <ArrowLeftIcon className="size-4 text-ui-muted transition-transform group-hover:-translate-x-0.5" />
                </span>
                <span>{t("sidebar.back")}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className="codex-sidebar-resizer"
        onPointerDown={startResize}
        title={t("sidebar.resizeTooltip")}
      />

      {conversationMenu && (
        <div
          className="fixed z-50 flex min-w-64 flex-col overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-minimal"
          style={{
            left: conversationMenu.x,
            top: conversationMenu.y,
            maxHeight: `${Math.min(420, Math.max(160, window.innerHeight - conversationMenu.y - 16))}px`,
          }}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 text-ui-caption font-medium text-ui-muted">
            <SparklesIcon size={13} />
            {t("sidebar.deriveNewConversation")}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {derivationActions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left text-ui-body outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onDeriveConversation(conversationMenu.conv.id, action.id);
                  setConversationMenu(null);
                }}
              >
                <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {action.label}
                  </span>
                  {action.description && (
                    <span className="block truncate text-ui-caption text-ui-muted">
                      {action.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
