import {
  FileTextIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "@/i18n";
import { useTranslation } from "@/i18n";
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
  type PreferenceScope,
  preferencesFromProfile,
  updateProfilePreference,
} from "../profile/preferences";
import {
  readProfile,
  restoreProfile,
  snapshotProfile,
  writeProfile,
} from "../profile/profile";
import { PreferencesPanel } from "./PreferencesPanel";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type Owner = "user" | "shared" | "ai";

// Section title → ownership. Ownership determines badge, hint, and editability (ai = read-only).
const SECTION_META: Record<string, { key: string; owner: Owner }> = {
  "About me": { key: "aboutMe", owner: "shared" },
  "AI preferences": { key: "aiPreferences", owner: "user" },
  "Working on": { key: "workingOn", owner: "ai" },
  "Comfortable with": { key: "comfortableWith", owner: "ai" },
  "Avoids / rarely attempts": { key: "avoids", owner: "ai" },
  Interests: { key: "interests", owner: "ai" },
  "Recently introduced": { key: "recentlyIntroduced", owner: "ai" },
  "Expression gaps": { key: "expressionGaps", owner: "ai" },
  "My notes": { key: "myNotes", owner: "user" },
};

const BADGE_CLS: Record<Owner, string> = {
  user: "bg-primary/10 text-primary",
  shared: "bg-muted text-ui-muted",
  ai: "bg-muted text-ui-muted",
};

function ownerOf(title: string): Owner {
  return SECTION_META[title]?.owner ?? "ai";
}

function sectionLabel(title: string, t: TFunction): string {
  const key = SECTION_META[title]?.key as string | undefined;
  if (!key) return title;
  // Key is always one of the profile.section.* keys defined in en.ts.
  return t(`profile.section.${key}` as Parameters<TFunction>[0]);
}

// Editable = user-owned or shared; AI-maintained sections are read-only.
function isEditable(title: string): boolean {
  return ownerOf(title) !== "ai";
}

// Strip placeholder HTML comments from "My notes" body for display.
function displayBody(s: ProfileSection): string {
  if (s.title !== "My notes") return s.body;
  return s.body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

// A section body that is only the template placeholder (a lone "-" / bullets /
// whitespace) counts as empty, so cold-start hints don't think it's filled.
function isEffectivelyEmpty(body: string): boolean {
  return body.replace(/[-*\s]/g, "").length === 0;
}

function normalizeProfileMd(md: string): string {
  return serializeProfile(ensureSections(parseProfile(md)));
}

// Cold-start nudge: shown only while "About me" is still empty. The maintainer
// rarely fills this on its own (durable personal facts seldom surface verbatim
// in chat), so a personal conversation partner benefits from the user seeding it.
function AboutMeCallout({ onFill }: { onFill: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <UserRoundIcon size={16} className="shrink-0 text-primary" />
        <h3 className="m-0 text-ui-body font-semibold text-foreground">
          {t("profile.aboutMeCalloutTitle")}
        </h3>
      </div>
      <p className="m-0 text-ui-body leading-snug text-ui-muted">
        {t("profile.aboutMeCalloutDesc")}
      </p>
      <div>
        <Button type="button" size="sm" onClick={onFill}>
          <SparklesIcon size={14} />
          {t("profile.aboutMeCalloutCta")}
        </Button>
      </div>
    </div>
  );
}

// Read-only card: content height adapts to its body; no inner scrollbar.
// Editable cards are fully clickable to open the edit overlay; read-only ones have no hover feedback.
function SectionCard({
  section,
  onEdit,
}: {
  section: ProfileSection;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const owner = ownerOf(section.title);
  const badgeCls = BADGE_CLS[owner];
  const body = displayBody(section);
  const editable = !!onEdit;
  const label = sectionLabel(section.title, t);
  const badgeText =
    owner === "user"
      ? t("profile.badgeUser")
      : owner === "shared"
        ? t("profile.badgeShared")
        : t("profile.badgeAi");

  const header = (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-ui-body font-semibold">
        {label}
        {editable && (
          <PencilIcon
            size={13}
            className="shrink-0 text-ui-muted opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-ui-caption ${badgeCls}`}
      >
        {badgeText}
      </span>
    </div>
  );
  const content = body ? (
    <p className="m-0 whitespace-pre-wrap text-ui-body leading-relaxed text-foreground">
      {body}
    </p>
  ) : (
    <p className="m-0 text-ui-body text-ui-muted">
      {editable ? t("profile.clickToAdd") : t("profile.emptySection")}
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

// Distribute cards into n columns (greedy: each card goes to the shortest column) for a waterfall layout.
function distribute(sections: ProfileSection[], n: number): ProfileSection[][] {
  const cols: ProfileSection[][] = Array.from({ length: n }, () => []);
  const heights = new Array(n).fill(0);
  for (const s of sections) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].push(s);
    heights[i] += displayBody(s).length + 60; // 60 ≈ base height for title/padding
  }
  return cols;
}

// Responsive column count: narrow=1, wide=2/3, max 3 columns.
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

// Edit overlay: open when clicking a section card. Esc closes it.
function EditOverlay({
  section,
  onSave,
  onCancel,
}: {
  section: ProfileSection;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // Start blank when the body is just the template placeholder, so the guiding
  // placeholder shows instead of a stray "-".
  const [draft, setDraft] = useState(() => {
    const body = displayBody(section);
    return isEffectivelyEmpty(body) ? "" : body;
  });
  const owner = ownerOf(section.title);
  const label = sectionLabel(section.title, t);
  const placeholder =
    section.title === "About me"
      ? t("profile.aboutMePlaceholder")
      : owner === "user"
        ? t("profile.userSectionPlaceholder")
        : t("profile.perLineHint");

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
      aria-label={t("profile.editSectionLabel", { name: label })}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onCancel}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: prevents background dismiss on inner click */}
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-card p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-ui-title font-semibold">{label}</h3>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCancel}
            aria-label={t("common.close")}
          >
            <XIcon size={16} />
          </Button>
        </div>
        <Textarea
          autoFocus
          aria-label={label}
          className="min-h-48 flex-1 resize-none font-mono text-ui-body leading-normal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSave(draft)}>{t("common.save")}</Button>
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
  const { t } = useTranslation();
  return (
    <section className="rounded-md border border-border/70 bg-card/80 p-4 shadow-minimal-flat">
      <div className="mb-3">
        <h3 className="m-0 text-ui-body font-semibold">
          {t("profile.maintenanceTitle")}
        </h3>
        <p className="m-0 mt-1 text-ui-body leading-snug text-ui-muted">
          {t("profile.maintenanceDesc")}
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
            {dirty ? t("profile.saveMarkdown") : t("profile.alreadySaved")}
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
          {busy ? t("profile.refreshingBtn") : t("profile.aiRefresh")}
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
            {t("profile.undoRefresh")}
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
          {raw ? t("profile.backToStructured") : t("profile.editRawMarkdown")}
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
  const { t } = useTranslation();
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

  // Serialize current edit state to canonical MD (all section titles always present).
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

  // Keep refs to latest values so async flush/sync handlers always see current state.
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
        console.warn("Profile sync failed:", e);
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

  // Flush unsaved edits when navigating away from the profile page.
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

  // Edit overlay save: update that section then immediately persist.
  async function saveSection(title: string, body: string) {
    if (!loaded) return;
    const next = sections.map((s) => (s.title === title ? { ...s, body } : s));
    setSections(next);
    setEditingTitle(null);
    const md = serializeProfile({ header, sections: next });
    await writeProfile(md);
    setSavedMd(md);
    setStatus(t("profile.savedStatus"));
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
    setStatus(t("profile.aiClassifyingStatus"));
    try {
      await writeProfile(currentMd);
      const next = await applyProfilePreferenceInstruction(
        instruction,
        currentMd,
      );
      await writeProfile(next);
      applyProfileMdToState(next);
      setSmartDraft("");
      setStatus(t("profile.classifiedStatus"));
    } catch (e) {
      setStatus(
        t("profile.classifyFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
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
    setStatus(t("profile.savedStatus"));
  }

  async function refresh() {
    if (!loaded) return;
    setBusy(true);
    setStatus(t("profile.refreshingStatus"));
    try {
      await writeProfile(currentMd);
      setSavedMd(currentMd);
      await snapshotProfile();
      const r = await runMaintainerNow();
      if (r.written && r.profile) {
        if (raw) {
          setRawText(r.profile);
          setSavedMd(r.profile);
        } else {
          load(r.profile);
        }
        setCanUndo(true);
        setStatus(t("profile.refreshedStatus"));
      } else {
        setStatus(t("profile.refreshNotUpdated", { reason: r.reason ?? "" }));
      }
    } catch (e) {
      setStatus(
        t("profile.refreshFailed", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const restored = await restoreProfile();
    if (restored == null) {
      setStatus(t("profile.noUndoVersion"));
      return;
    }
    if (raw) {
      setRawText(restored);
      setSavedMd(restored);
    } else {
      load(restored);
    }
    setCanUndo(false);
    setStatus(t("profile.undoneStatus"));
  }

  const editingSection = sections.find((s) => s.title === editingTitle) ?? null;

  const gridRef = useRef<HTMLDivElement>(null);
  const colCount = useColumnCount(gridRef, loaded && !raw);
  const displaySections = sections.filter(
    (section) => !isPreferenceSection(section),
  );
  const columns = distribute(displaySections, colCount);
  const aboutMeEmpty = useMemo(() => {
    const s = sections.find((x) => x.title === "About me");
    return !!s && isEffectivelyEmpty(s.body);
  }, [sections]);

  return (
    <div className="h-full overflow-y-auto px-6 py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <h2 className="m-0 text-ui-title font-semibold tracking-tight">
              {t("sidebar.profile")}
            </h2>
            <p className="m-0 mt-2 text-ui-body leading-relaxed text-ui-muted">
              {t("profile.description")}
            </p>
            {header && (
              <p className="m-0 mt-3 truncate font-mono text-ui-caption text-ui-muted">
                {header}
              </p>
            )}
          </div>
        </header>

        {!loaded ? (
          <p className="m-0 text-ui-body text-ui-muted">
            {t("profile.loading")}
          </p>
        ) : raw ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Textarea
              aria-label={t("profile.rawAriaLabel")}
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
              {aboutMeEmpty && (
                <AboutMeCallout onFill={() => setEditingTitle("About me")} />
              )}
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="m-0 text-ui-body font-semibold">
                  {t("profile.sections")}
                </h3>
                <span className="text-ui-caption text-ui-muted">
                  {t("profile.modulesCount", {
                    n: String(displaySections.length),
                  })}
                </span>
              </div>
              {/* Waterfall layout: JS distributes cards into equal-width flex columns, top-aligned. */}
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
