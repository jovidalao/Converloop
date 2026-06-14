import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  type PhysicalSize,
} from "@tauri-apps/api/window";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GraduationCapIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelLeftIcon,
  PanelRightIcon,
  SearchIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AgentLibraryView } from "./components/AgentLibraryView";
import { AppDesignView } from "./components/AppDesignView";
import { ChatView } from "./components/ChatView";
import { CoachPanel } from "./components/CoachPanel";
import { CommandPalette } from "./components/CommandPalette";
import { CustomLearningView } from "./components/CustomLearningView";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { LearningAgentsView } from "./components/LearningAgentsView";
import { LogsView } from "./components/LogsView";
import { MasteryView } from "./components/MasteryView";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { ProfileView } from "./components/ProfileView";
import { SettingsView } from "./components/SettingsView";
import { type MainView, Sidebar } from "./components/Sidebar";
import { Button } from "./components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { pruneAgentJobs } from "./db/agent-jobs";
import { getAppState, setAppState } from "./db/app-state";
import {
  type ConversationMeta,
  clearActiveConversationId,
  createConversation,
  createDrillConversation,
  deleteConversation,
  ensureActiveConversation,
  listConversations,
  renameConversation,
  setActiveConversationId,
  setConversationPinned,
  titleFromInput,
} from "./db/conversations";
import {
  ensureBuiltInLearningAgents,
  type LearningAgentMeta,
  listLearningAgents,
} from "./db/learning-agents";
import type { ChatTurn } from "./db/turns";
import { drillSummary, ensureBuiltInDrills, listDrills } from "./drills/store";
import type { DrillParams, DrillSummary } from "./drills/types";
import { useTranslation } from "./i18n";
import {
  actionShortcutLabel,
  matchesActionShortcut,
  useKeybindings,
} from "./lib/app-actions";
import { withViewTransition } from "./lib/view-transition";
import { flushMaintainerSoon } from "./profile/maintainer-runner";
import { beginAction, reloadCustomRuntimeAgents } from "./runtime";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const COACH_MIN = 300;
const COACH_MAX = 560;

// Small-window mode: the compact OS window size, plus the relaxed min size it
// needs (the configured 720×520 min would otherwise clamp the shrink). Restored
// to FULL_MIN_* on exit.
const COMPACT_W = 420;
const COMPACT_H = 600;
const COMPACT_MIN_W = 360;
const COMPACT_MIN_H = 480;
const FULL_MIN_W = 720;
const FULL_MIN_H = 520;

type AppLocation = {
  view: MainView;
  activeId: string;
};

type DraftKind = "chat" | "drill" | "learning_agent";

// app_state flag: set after the first-run wizard finishes (or is skipped, or
// the app starts with existing data). Travels with backups like other markers.
const ONBOARDING_DONE_KEY = "lang-agent.onboardingDone";

function sameLocation(a: AppLocation, b: AppLocation): boolean {
  return a.view === b.view && a.activeId === b.activeId;
}

// Views inside the settings sub-menu (the three settings pages + three profile
// database pages). Entering these drills the sidebar into the settings panel;
// "Create lesson" lives under the main sidebar's custom-learning group and is
// not treated as a settings view.
const SETTINGS_VIEWS: ReadonlySet<MainView> = new Set<MainView>([
  "settings-general",
  "settings-customize",
  "settings-llm",
  "settings-stt",
  "settings-tts",
  "settings-commands",
  "design",
  "mastery",
  "agents",
  "settings-logs",
  "profile",
]);

function isSettingsView(view: MainView): boolean {
  return SETTINGS_VIEWS.has(view);
}

function App() {
  const { t, locale } = useTranslation();
  // Subscribe so topbar/sidebar shortcut labels refresh when a chord is remapped.
  useKeybindings();
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [learningAgents, setLearningAgents] = useState<LearningAgentMeta[]>([]);
  // Training modes (drills) from the training center: built-ins + custom, localized for display.
  const [drills, setDrills] = useState<DrillSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  // Which kind of draft the current draftId is: a blank chat, a drill start page, or a lesson start page.
  const [draftKind, setDraftKind] = useState<DraftKind>("chat");
  // The drill behind a "drill" draft (null otherwise).
  const [draftDrill, setDraftDrill] = useState<DrillSummary | null>(null);
  const [draftLearningAgentId, setDraftLearningAgentId] = useState<
    string | null
  >(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<MainView>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [coachOpen, setCoachOpen] = useState(
    () => localStorage.getItem("coachOpen") !== "false",
  );
  const [smallWindow, setSmallWindow] = useState(
    () => localStorage.getItem("smallWindow") === "true",
  );
  const prevWindowSizeRef = useRef<PhysicalSize | null>(null);
  const [coachTurns, setCoachTurns] = useState<ChatTurn[]>([]);
  const [coachDraft, setCoachDraft] = useState<{
    text: string;
    nonce: number;
  } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [derivationBusy, setDerivationBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [resizingCoach, setResizingCoach] = useState(false);
  const [backStack, setBackStack] = useState<AppLocation[]>([]);
  const [forwardStack, setForwardStack] = useState<AppLocation[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : 248;
  });
  const [coachWidth, setCoachWidth] = useState(() => {
    const saved = Number(localStorage.getItem("coachWidth"));
    return saved >= COACH_MIN && saved <= COACH_MAX ? saved : 360;
  });

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("coachWidth", String(coachWidth));
  }, [coachWidth]);

  useEffect(() => {
    localStorage.setItem("coachOpen", String(coachOpen));
  }, [coachOpen]);

  // Small-window mode shrinks the real OS window to a compact chat panel and
  // restores the previous size on exit. The configured min size (720×520) must
  // be relaxed before the shrink, or setSize would be clamped to it.
  useEffect(() => {
    localStorage.setItem("smallWindow", String(smallWindow));
    if (!("__TAURI_INTERNALS__" in window)) return;
    const win = getCurrentWindow();
    let cancelled = false;
    void (async () => {
      if (smallWindow) {
        if (!prevWindowSizeRef.current) {
          prevWindowSizeRef.current = await win.innerSize();
        }
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const cx = pos.x + size.width / 2;
        const cy = pos.y + size.height / 2;
        await win.setMinSize(new LogicalSize(COMPACT_MIN_W, COMPACT_MIN_H));
        if (!cancelled) {
          await win.setSize(new LogicalSize(COMPACT_W, COMPACT_H));
          const newSize = await win.outerSize();
          await win.setPosition(
            new PhysicalPosition(
              Math.round(cx - newSize.width / 2),
              Math.round(cy - newSize.height / 2),
            ),
          );
        }
      } else {
        const prev = prevWindowSizeRef.current;
        if (prev) {
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          const cx = pos.x + size.width / 2;
          const cy = pos.y + size.height / 2;
          await win.setSize(prev);
          prevWindowSizeRef.current = null;
          const newSize = await win.outerSize();
          await win.setPosition(
            new PhysicalPosition(
              Math.round(cx - newSize.width / 2),
              Math.round(cy - newSize.height / 2),
            ),
          );
        }
        await win.setMinSize(new LogicalSize(FULL_MIN_W, FULL_MIN_H));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [smallWindow]);

  // Top-level lightweight toast (e.g. a derivation failure): auto-dismisses
  // after a few seconds, and can also be closed manually.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // When switching conversations, clear the previous conversation's leftover
  // per-turn feedback; the new conversation's ChatView re-reports it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId is only a trigger; the effect doesn't read it
  useEffect(() => {
    setCoachTurns([]);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    flushMaintainerSoon();
  }, [activeId]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) flushMaintainerSoon();
    }
    function onBeforeUnload() {
      flushMaintainerSoon();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  const toggleCoach = useCallback(() => {
    setCoachOpen((c) => !c);
  }, []);

  const toggleSmallWindow = useCallback(() => {
    setSmallWindow((c) => !c);
  }, []);

  const applyLocation = useCallback(
    (loc: AppLocation) => {
      if (isSettingsView(loc.view)) {
        setCollapsed(false);
      }
      if (
        loc.view === "chat" &&
        loc.activeId !== draftId &&
        conversations.some((c) => c.id === loc.activeId)
      ) {
        setActiveConversationId(loc.activeId);
      }
      withViewTransition(() => {
        setCoachDraft(null);
        setActiveId(loc.activeId);
        setView(loc.view);
      });
    },
    [conversations, draftId],
  );

  const navigateTo = useCallback(
    (loc: AppLocation) => {
      if (!activeId) {
        applyLocation(loc);
        return;
      }
      const current = { view, activeId };
      if (sameLocation(current, loc)) return;
      setBackStack((stack) => [...stack, current].slice(-50));
      setForwardStack([]);
      applyLocation(loc);
    },
    [activeId, applyLocation, view],
  );

  const goBack = useCallback(() => {
    if (!activeId) return;
    const current = { view, activeId };
    setBackStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setForwardStack((forward) => [...forward, current].slice(-50));
      applyLocation(next);
      return stack.slice(0, -1);
    });
  }, [activeId, applyLocation, view]);

  const goForward = useCallback(() => {
    if (!activeId) return;
    const current = { view, activeId };
    setForwardStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setBackStack((back) => [...back, current].slice(-50));
      applyLocation(next);
      return stack.slice(0, -1);
    });
  }, [activeId, applyLocation, view]);

  const openDraftConversation = useCallback(() => {
    const id = crypto.randomUUID();
    setDraftId(id);
    setDraftKind("chat");
    setDraftDrill(null);
    setDraftLearningAgentId(null);
    navigateTo({ view: "chat", activeId: id });
  }, [navigateTo]);

  // Drill: enter a fresh start page like a new chat — no conversation row is created until the learner
  // commits the start-page params (chip / typed theme / Start), which materializes it via materializeDrillDraft.
  const openDrillDraft = useCallback(
    (drill: DrillSummary) => {
      const id = crypto.randomUUID();
      setDraftId(id);
      setDraftKind("drill");
      setDraftDrill(drill);
      setDraftLearningAgentId(null);
      navigateTo({ view: "chat", activeId: id });
    },
    [navigateTo],
  );

  // Lesson drafts mirror Rapid Q&A: selecting a lesson opens a frontend-only start page. The conversation row is
  // created only after the learner presses Start.
  const openLearningAgentDraft = useCallback(
    (agentId: string) => {
      const id = crypto.randomUUID();
      setDraftId(id);
      setDraftKind("learning_agent");
      setDraftDrill(null);
      setDraftLearningAgentId(agentId);
      navigateTo({ view: "chat", activeId: id });
    },
    [navigateTo],
  );

  const focusPanel = useCallback(
    (panel: "sidebar" | "chat" | "coach") => {
      if (panel === "sidebar") {
        setCollapsed(false);
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(".codex-sidebar")?.focus();
        });
        return;
      }
      if (panel === "chat") {
        if (activeId) navigateTo({ view: "chat", activeId });
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLTextAreaElement>(
            ".codex-main textarea",
          );
          input?.focus();
        });
        return;
      }
      setCoachOpen(true);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".codex-coach")?.focus();
      });
    },
    [activeId, navigateTo],
  );

  // Coach panel's turn index → scroll the chat to that turn. The turn cards are
  // tagged with data-turn-id; both panels are mounted together when the coach is
  // visible, so a DOM lookup is enough (no ref plumbing through ChatView).
  const jumpToTurn = useCallback((turnId: string) => {
    const el = document.querySelector<HTMLElement>(
      `[data-turn-id="${turnId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.dataset.turnJumpHighlight = "true";
    window.setTimeout(() => {
      if (el.dataset.turnJumpHighlight === "true") {
        delete el.dataset.turnJumpHighlight;
      }
    }, 1200);
  }, []);

  // ⌘, settings · ⌘B sidebar · ⌘N new chat · ⌘1/2/3 focus the three panes · ⌘/ shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const inField =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input, textarea, select, [contenteditable]");
      if (matchesActionShortcut(e, "settings")) {
        e.preventDefault();
        if (activeId) navigateTo({ view: "settings-general", activeId });
        return;
      }
      if (matchesActionShortcut(e, "command-palette")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (matchesActionShortcut(e, "new-chat")) {
        e.preventDefault();
        openDraftConversation();
        return;
      }
      if (matchesActionShortcut(e, "navigate-back") && !inField) {
        e.preventDefault();
        goBack();
        return;
      }
      if (matchesActionShortcut(e, "navigate-forward") && !inField) {
        e.preventDefault();
        goForward();
        return;
      }
      if (matchesActionShortcut(e, "shortcuts")) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }
      if (matchesActionShortcut(e, "focus-sidebar")) {
        e.preventDefault();
        focusPanel("sidebar");
        return;
      }
      if (matchesActionShortcut(e, "focus-chat")) {
        e.preventDefault();
        focusPanel("chat");
        return;
      }
      if (matchesActionShortcut(e, "focus-coach")) {
        e.preventDefault();
        focusPanel("coach");
        return;
      }
      if (matchesActionShortcut(e, "toggle-sidebar") && !inField) {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeId,
    navigateTo,
    toggleSidebar,
    openDraftConversation,
    focusPanel,
    goBack,
    goForward,
  ]);

  const refresh = useCallback(
    () => listConversations().then(setConversations),
    [],
  );

  const refreshLearningAgents = useCallback(async () => {
    await reloadCustomRuntimeAgents();
    setLearningAgents(await listLearningAgents());
  }, []);

  const refreshDrills = useCallback(async () => {
    const records = await listDrills();
    setDrills(records.map((record) => drillSummary(record, locale)));
  }, [locale]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draftId is only the initial blank chat id; later draft switches must not rerun startup selection.
  useEffect(() => {
    void (async () => {
      await ensureBuiltInLearningAgents();
      await ensureBuiltInDrills();
      await refreshLearningAgents();
      await refreshDrills();
      const id = await ensureActiveConversation();
      setActiveId(id ?? draftId);
      await refresh();
      setReady(true);
      // First run (no history at all): walk through languages + provider setup once.
      // Existing users get the flag set silently so the wizard never appears.
      const onboarded = await getAppState(ONBOARDING_DONE_KEY);
      if (!onboarded) {
        const convs = await listConversations();
        if (convs.length === 0) setOnboardingOpen(true);
        else await setAppState(ONBOARDING_DONE_KEY, "1");
      }
      // Run-log retention: prune old finished agent_job rows in the background after the UI is up.
      void pruneAgentJobs().catch(() => {});
    })();
  }, [refresh, refreshLearningAgents]);

  // Re-localize the drill summaries when the UI language changes (names/descriptions come from the
  // drill documents' locales map). Runs once on mount too, which is harmless — the startup effect's
  // refreshDrills (after seeding) wins the race.
  useEffect(() => {
    if (ready) void refreshDrills();
  }, [ready, refreshDrills]);

  function selectConversation(id: string) {
    setActiveConversationId(id); // persist; no view transition
    navigateTo({ view: "chat", activeId: id });
  }

  async function materializeDraftConversation(id: string) {
    await createConversation(undefined, id);
    setActiveConversationId(id);
    setDraftId((current) => (current === id ? crypto.randomUUID() : current));
  }

  // Materialize a drill draft into a real drill conversation seeded with the chosen params. Called by
  // ChatView before the AI kickoff, so the conversation row (with the drill modifier) exists when the
  // drill opens. Item-targeting drills are titled from the snapshotted item labels.
  async function materializeDrillDraft(
    id: string,
    drill: DrillSummary,
    params: DrillParams,
  ) {
    const title = params.items?.length
      ? `${drill.name} · ${params.items.map((item) => item.label).join(" / ")}`
      : undefined;
    await createDrillConversation({ id: drill.id, def: drill.def }, params, {
      title,
      id,
    });
    setActiveConversationId(id);
    setDraftId((current) => (current === id ? crypto.randomUUID() : current));
    setDraftKind("chat");
    setDraftDrill(null);
    await refresh();
  }

  // Materialize a new-chat draft seeded with a chosen topic into a real practice conversation (titled from the topic).
  // Called by ChatView before the AI kickoff, so the conversation row exists when the AI opens the chat on that topic.
  async function materializeTopicDraft(id: string, topic: string) {
    await createConversation(titleFromInput(topic), id);
    setActiveConversationId(id);
    setDraftId((current) => (current === id ? crypto.randomUUID() : current));
    setDraftKind("chat");
    await refresh();
  }

  async function materializeLearningAgentDraft(id: string, agentId: string) {
    const agent = learningAgents.find((a) => a.id === agentId);
    const title = agent?.name ?? t("app.customLearningFallback");
    await createConversation(title, id, {
      kind: "learning_agent",
      learningAgentId: agentId,
    });
    setActiveConversationId(id);
    setDraftId((current) => (current === id ? crypto.randomUUID() : current));
    setDraftKind("chat");
    setDraftLearningAgentId(null);
    await refresh();
  }

  async function deriveConversation(
    conversationId: string,
    actionId: string,
    sourceTurnId?: string,
  ) {
    if (derivationBusy) return;
    setDerivationBusy(true);
    try {
      const result = await beginAction(actionId, {
        conversationId,
        sourceTurnId,
      });
      await refresh();
      if (result.navigateTo) selectConversation(result.navigateTo);
    } catch (e) {
      setToast(
        t("app.deriveFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setDerivationBusy(false);
    }
  }

  async function rename(id: string, title: string) {
    await renameConversation(id, title);
    await refresh();
  }

  async function togglePin(id: string, pinned: boolean) {
    await setConversationPinned(id, pinned);
    await refresh();
  }

  async function remove(id: string) {
    await deleteConversation(id);
    const rest = await listConversations();
    setConversations(rest);
    if (id === activeId) {
      const nextId = rest[0]?.id;
      if (nextId) {
        selectConversation(nextId);
      } else {
        clearActiveConversationId();
        openDraftConversation();
      }
    }
  }

  function startTopbarDrag(e: MouseEvent<HTMLElement>) {
    if (e.button !== 0) return;
    if (e.detail > 1) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button,input,textarea,select,a,[data-no-window-drag]")
    )
      return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    void getCurrentWindow().startDragging();
  }

  function startCoachResize(e: ReactPointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = coachWidth;
    let frame = 0;
    let nextWidth = startWidth;

    function flushResize() {
      frame = 0;
      setCoachWidth(Math.min(COACH_MAX, Math.max(COACH_MIN, nextWidth)));
    }

    function onMove(ev: PointerEvent) {
      nextWidth = startWidth - (ev.clientX - startX);
      if (!frame) frame = requestAnimationFrame(flushResize);
    }

    function finishResize() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        setCoachWidth(Math.min(COACH_MAX, Math.max(COACH_MIN, nextWidth)));
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizingCoach(false);
    }

    setResizingCoach(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  if (!ready || !activeId)
    return (
      <div className="flex h-full min-h-screen items-center justify-center text-ui-muted">
        {t("common.loading")}
      </div>
    );

  const activeConversation = conversations.find((c) => c.id === activeId);
  const draftActive = view === "chat" && activeId === draftId;
  // Small-window mode always shows the chat, regardless of the underlying view,
  // so the draft check can't rely on view === "chat".
  const chatIsDraft = smallWindow ? activeId === draftId : draftActive;
  const activeDraftLearningAgent =
    chatIsDraft && draftKind === "learning_agent" && draftLearningAgentId
      ? (learningAgents.find((a) => a.id === draftLearningAgentId) ?? null)
      : null;
  const currentChatKind =
    activeConversation?.kind ??
    (chatIsDraft && draftKind === "learning_agent"
      ? "learning_agent"
      : "practice");
  // The coach panel only appears in regular practice conversations (lessons
  // give feedback inline, without structured correction). It's hidden entirely
  // in small-window mode.
  const coachEligible = view === "chat" && currentChatKind === "practice";
  const coachVisible = coachEligible && coachOpen && !smallWindow;
  const settingsMode = isSettingsView(view);
  const TOPBAR_TITLES: Partial<Record<MainView, string>> = {
    profile: t("viewTitles.profile"),
    mastery: t("viewTitles.mastery"),
    learning: t("viewTitles.learning"),
    "learning-gallery": t("viewTitles.customLearning"),
    design: t("viewTitles.design"),
    agents: t("viewTitles.agents"),
    "settings-logs": t("viewTitles.logs"),
    "settings-general": t("viewTitles.general"),
    "settings-customize": t("viewTitles.customize"),
    "settings-llm": t("viewTitles.llm"),
    "settings-stt": t("viewTitles.stt"),
    "settings-tts": t("viewTitles.tts"),
    "settings-commands": t("viewTitles.commands"),
  };
  const topbarTitle =
    view === "chat"
      ? draftActive
        ? draftKind === "learning_agent"
          ? (activeDraftLearningAgent?.name ?? t("app.customLearningFallback"))
          : draftKind === "drill"
            ? (draftDrill?.name ?? t("app.newChat"))
            : t("app.newChat")
        : (activeConversation?.title ?? "")
      : (TOPBAR_TITLES[view] ?? "");

  const secondaryView =
    view === "profile" ? (
      <ProfileView />
    ) : view === "mastery" ? (
      <MasteryView />
    ) : view === "learning" ? (
      <LearningAgentsView
        onRefresh={refreshLearningAgents}
        onStartLesson={openLearningAgentDraft}
      />
    ) : view === "learning-gallery" ? (
      <CustomLearningView
        drills={drills}
        onStartLesson={openLearningAgentDraft}
        onStartDrill={openDrillDraft}
        onOpenCreate={() => navigateTo({ view: "learning", activeId })}
        onRefresh={refreshLearningAgents}
        onRefreshDrills={refreshDrills}
      />
    ) : view === "design" ? (
      <AppDesignView />
    ) : view === "agents" ? (
      <AgentLibraryView onOpenView={(v) => navigateTo({ view: v, activeId })} />
    ) : view === "settings-logs" ? (
      <LogsView />
    ) : view === "settings-general" ? (
      <SettingsView section="general" />
    ) : view === "settings-customize" ? (
      <SettingsView section="customize" />
    ) : view === "settings-llm" ? (
      <SettingsView section="llm" />
    ) : view === "settings-stt" ? (
      <SettingsView section="stt" />
    ) : view === "settings-tts" ? (
      <SettingsView section="tts" />
    ) : view === "settings-commands" ? (
      <SettingsView section="commands" />
    ) : null;

  return (
    <div
      className="codex-shell"
      data-sidebar-collapsed={collapsed}
      data-coach-open={coachVisible}
      data-compact={smallWindow}
      data-sidebar-resizing={resizingSidebar}
      data-coach-resizing={resizingCoach}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--coach-width": `${coachWidth}px`,
        } as CSSProperties
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: custom Tauri chrome drag region */}
      <header
        className="codex-topbar"
        data-tauri-drag-region
        onMouseDown={startTopbarDrag}
      >
        {!smallWindow && (
          <div className="codex-topbar-left">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="codex-chrome-button"
                    onClick={toggleSidebar}
                    aria-label={
                      collapsed
                        ? t("app.expandSidebar")
                        : t("app.collapseSidebar")
                    }
                  >
                    {collapsed ? <PanelRightIcon /> : <PanelLeftIcon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="flex items-center gap-2"
                >
                  <span>
                    {collapsed
                      ? t("app.expandSidebar")
                      : t("app.collapseSidebar")}
                  </span>
                  <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                    {actionShortcutLabel("toggle-sidebar")}
                  </kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="codex-chrome-button"
                    onClick={goBack}
                    disabled={backStack.length === 0}
                    aria-label={t("app.back")}
                  >
                    <ChevronLeftIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="flex items-center gap-2"
                >
                  <span>{t("app.back")}</span>
                  <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                    {actionShortcutLabel("navigate-back")}
                  </kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="codex-chrome-button"
                    onClick={goForward}
                    disabled={forwardStack.length === 0}
                    aria-label={t("app.forward")}
                  >
                    <ChevronRightIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  className="flex items-center gap-2"
                >
                  <span>{t("app.forward")}</span>
                  <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                    {actionShortcutLabel("navigate-forward")}
                  </kbd>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {!smallWindow && (
          <div className="codex-titlebar">
            <span className="truncate">{topbarTitle}</span>
          </div>
        )}
        <div className="codex-topbar-right">
          <TooltipProvider delayDuration={300}>
            {!smallWindow && (
              <>
                {collapsed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="codex-chrome-button"
                        onClick={openDraftConversation}
                        aria-label={t("app.newChat")}
                      >
                        <SquarePenIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      className="flex items-center gap-2"
                    >
                      <span>{t("app.newChat")}</span>
                      <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                        {actionShortcutLabel("new-chat")}
                      </kbd>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="codex-chrome-button"
                      onClick={() => setPaletteOpen(true)}
                      aria-label={t("app.search")}
                    >
                      <SearchIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="end"
                    className="flex items-center gap-2"
                  >
                    <span>{t("app.search")}</span>
                    <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 font-sans text-ui-caption text-ui-muted">
                      {actionShortcutLabel("command-palette")}
                    </kbd>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {!smallWindow && (
              <span className="codex-topbar-divider" aria-hidden />
            )}
            {/* View-toggle cluster: pinned to the far-right edge. */}
            <div className="codex-topbar-group">
              {!smallWindow && coachEligible && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="codex-chrome-button"
                      onClick={toggleCoach}
                      data-active={coachVisible}
                      aria-pressed={coachVisible}
                      aria-label={
                        coachVisible ? t("app.hideCoach") : t("app.showCoach")
                      }
                    >
                      <GraduationCapIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end">
                    <span>
                      {coachVisible ? t("app.hideCoach") : t("app.showCoach")}
                    </span>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="codex-chrome-button"
                    onClick={toggleSmallWindow}
                    data-active={smallWindow}
                    aria-pressed={smallWindow}
                    aria-label={
                      smallWindow
                        ? t("app.exitSmallWindow")
                        : t("app.smallWindow")
                    }
                  >
                    {smallWindow ? <Maximize2Icon /> : <Minimize2Icon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end">
                  <span>
                    {smallWindow
                      ? t("app.exitSmallWindow")
                      : t("app.smallWindow")}
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </header>

      <div className="contents" data-focus-zone="sidebar">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          newChatActive={draftActive && draftKind === "chat"}
          view={view}
          onSelect={selectConversation}
          onNewChat={openDraftConversation}
          onDeriveConversation={(id, actionId) =>
            void deriveConversation(id, actionId)
          }
          onRename={(id, t) => void rename(id, t)}
          onDelete={(id) => void remove(id)}
          onTogglePin={(id, pinned) => void togglePin(id, pinned)}
          onOpenView={(v) => navigateTo({ view: v, activeId })}
          settingsMode={settingsMode}
          onExitSettings={() => navigateTo({ view: "chat", activeId })}
          width={sidebarWidth}
          onResize={(w) =>
            setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
          }
          onResizeStart={() => setResizingSidebar(true)}
          onResizeEnd={() => setResizingSidebar(false)}
        />
      </div>

      <main className="codex-main relative flex min-h-0 flex-col overflow-hidden">
        <div
          className="flex min-h-0 flex-1 flex-col data-[hidden=true]:hidden"
          data-hidden={!smallWindow && view !== "chat"}
        >
          <ChatView
            key={activeId}
            conversationId={activeId}
            isDraft={chatIsDraft}
            drillDraft={
              chatIsDraft && draftKind === "drill" ? draftDrill : null
            }
            isLearningAgentDraft={chatIsDraft && draftKind === "learning_agent"}
            learningAgentDraft={activeDraftLearningAgent}
            mode={currentChatKind}
            onCreateDraftConversation={materializeDraftConversation}
            onCreateDrillDraft={materializeDrillDraft}
            onCreateTopicDraft={materializeTopicDraft}
            onCreateLearningAgentDraft={materializeLearningAgentDraft}
            onActivity={() => void refresh()}
            onTurnsChange={setCoachTurns}
            onNavigateConversation={selectConversation}
            onOpenCommandSettings={() =>
              navigateTo({ view: "settings-commands", activeId })
            }
            compact={smallWindow}
            externalDraft={coachDraft}
          />
        </div>
        {!smallWindow && secondaryView && (
          <div key={view} className="codex-secondary-view">
            {secondaryView}
          </div>
        )}
      </main>

      {coachVisible && (
        <aside className="codex-coach" tabIndex={-1}>
          <div
            className="codex-coach-resizer"
            onPointerDown={startCoachResize}
            title={t("sidebar.resizeTooltip")}
          />
          <CoachPanel
            turns={coachTurns}
            conversationId={activeId}
            onOpenView={(v) => navigateTo({ view: v, activeId })}
            onJumpToTurn={jumpToTurn}
            onUseHint={(text) =>
              setCoachDraft((cur) => ({
                text,
                nonce: (cur?.nonce ?? 0) + 1,
              }))
            }
          />
        </aside>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        conversations={conversations}
        learningAgents={learningAgents}
        drills={drills}
        onSelectConversation={selectConversation}
        onStartLearningAgent={openLearningAgentDraft}
        onNewChat={openDraftConversation}
        onStartDrill={openDrillDraft}
      />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {onboardingOpen && (
        <OnboardingWizard
          onDone={() => {
            setOnboardingOpen(false);
            void setAppState(ONBOARDING_DONE_KEY, "1");
          }}
        />
      )}

      {toast && (
        <div
          className="-translate-x-1/2 fixed bottom-20 left-1/2 z-50 flex max-w-[min(90vw,30rem)] items-center gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3 text-ui-body text-foreground shadow-lg"
          role="status"
          aria-live="polite"
        >
          <span className="min-w-0 flex-1">{toast}</span>
          <button
            type="button"
            className="shrink-0 text-ui-muted transition-colors hover:text-foreground"
            onClick={() => setToast(null)}
            aria-label={t("common.close")}
          >
            <XIcon size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
