// Drill format (lang-agent/drill@1) — type layer.
// A "drill" (training mode) is a user-visible practice format defined by a single Markdown document
// (YAML frontmatter = machine-enforced enums the runtime dispatches on; body sections = prompt prose).
// The document is the unit of storage, editing, AI generation, import/export and (future) marketplace
// distribution. See docs/drill-authoring.md for the authoring contract.

/** How the learner interacts each turn. This selects a UI mechanic preset — it is code, not prompt. */
export type DrillInteraction = "chat" | "say-hidden" | "say-visible";

/** What the start page asks for before the session begins. */
export type DrillSetup = "none" | "topic" | "review-items";

/** How the tutor grades each learner answer. */
export type DrillGrading = "tutor" | "standard-answer" | "none";

/** Which mastery dimension the graded signals are booked into (always by code, never by the LLM). */
export type DrillMastery = "production" | "review" | "listening" | "none";

/** Per-turn data the app feeds into the drill instructions. */
export type DrillFeed = "none" | "listening-words";

export interface DrillLocaleOverride {
  name?: string;
  description?: string;
  intro?: string;
}

// Parsed form of a drill document. `task` / `opening` / `setupGuidance` are prompt prose (English
// recommended); everything else is enum config validated by code. New capabilities must be added as
// OPTIONAL fields with defaults that reproduce the pre-capability behavior, so old documents keep
// working untouched (compat rule #1 — see capabilities.ts).
export interface DrillDefinition {
  format: 1;
  name: string;
  description: string;
  /** lucide icon name (subset — see DRILL_ICONS in icons.ts); falls back to a generic drill icon. */
  icon?: string;
  /** UI-language overrides for display fields, keyed by locale (e.g. "zh-CN"). */
  locales?: Record<string, DrillLocaleOverride>;
  /** Capability keys this document depends on; checked against the app's supported set at import. */
  requires: string[];
  interaction: DrillInteraction;
  setup: DrillSetup;
  grading: DrillGrading;
  mastery: DrillMastery;
  hints: "on" | "off";
  feed: DrillFeed;
  /** Longer start-page description (defaults to `description`). */
  intro?: string;
  /** # Task — per-turn instruction block injected into the conversation agent. */
  task: string;
  /** # Opening — instruction for the AI's first (kickoff) turn. */
  opening: string;
  /** # Setup — optional extra guidance for the topic recommender on the start page. */
  setupGuidance?: string;
  /** # Observer — optional per-turn parallel observer prompt (capability "observer"). */
  observer?: string;
  /** Data scopes the observer may read (reuses learning-agent scopes). */
  observerScopes?: string[];
  /** Whether the observer may propose learning-memory writes (always user-confirmed; never direct). */
  observerWriteback?: "none" | "propose";
  /** # Report — optional end-of-session report prompt (capability "report"). */
  report?: string;
  /** Reply-action buttons available on drill turns (capability "turn-actions"); undefined = all. */
  turnActions?: string[];
}

/** Per-conversation parameters chosen at session creation (the only mutable inputs to a drill). */
export interface DrillParams {
  /** The learner-chosen topic/scenario/theme (setup: topic). */
  setup?: string;
  /** Code-selected due-for-review items snapshotted at creation (setup: review-items). */
  items?: ReviewDrillItem[];
}

// Weak-spot drill item snapshot. Lives here (not db/conversations) so the drills module stays free of
// db imports; db/conversations re-exports it for existing call sites.
export interface ReviewDrillItem {
  key: string;
  label: string;
  type: string;
  example: string | null;
  notes: string | null;
}

/** What a drill conversation carries in agent_modifiers_json: a live reference (modeId) plus a full
 *  definition snapshot. Resolution prefers the live row (edits propagate to open sessions); the
 *  snapshot keeps old conversations working after the drill is deleted, and freezes the interaction
 *  mechanics so an in-flight session never changes shape mid-conversation. */
export interface DrillConversationModifier {
  modeId: string;
  params: DrillParams;
  def: DrillDefinition;
}

/** Resolved drill context handed to the reply/tutor agents for one turn. */
export interface ResolvedDrill {
  modeId: string;
  def: DrillDefinition;
  params: DrillParams;
}

/** Display summary for galleries / start pages / command palette. */
export interface DrillSummary {
  id: string;
  builtIn: boolean;
  name: string;
  description: string;
  intro: string;
  icon?: string;
  interaction: DrillInteraction;
  setup: DrillSetup;
  def: DrillDefinition;
}
