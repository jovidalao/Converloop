// Agent Runtime — type layer for hook dispatch seams.
// See docs/architecture.md for current runtime state; this file only defines types and hook names, no runtime logic.

import type { TutorAnalysis } from "../agents/schema";
import type { MasteryKeyHint, WeakItem } from "../agents/tutor";
import type {
  AgentModifiers,
  BranchKind,
  NewConversationContext,
} from "../db/conversations";
import type { ComfortableItem, ReviewItem } from "../db/mastery";
import type { ProficiencySnapshot } from "../lib/proficiency";
import type { CorrectionPreferenceFlags } from "../profile/preferences";
import type { ModelProvider } from "../providers/types";

// Runtime phase hooks. Only register hooks that are actually wired up and will be written to the agent_job run log
// (YAGNI: add new mount points when needed, don't pre-reserve unwired constants).
export const HOOKS = {
  conversationReply: "conversation.reply",
  conversationObserve: "conversation.observe",
  conversationAction: "conversation.action",
  turnExplain: "turn.explain",
  turnBilingual: "turn.bilingual",
  turnTranslate: "turn.translate",
  turnReplySuggestion: "turn.reply_suggestion",
} as const;

export type HookName = (typeof HOOKS)[keyof typeof HOOKS];

export type AgentKind =
  | "reply_producer"
  | "observer"
  | "transformer"
  | "action"
  | "background";

// Agent library grouped by "entry point": where the user triggers it / when it appears, not the technical kind.
export type AgentEntry =
  | "auto_turn" // automatic every turn (conversation partner / correction tutor / custom observer)
  | "selection" // when text is selected (selection explain/translate)
  | "reply_action" // reply action buttons (explain / bilingual / reply suggestion)
  | "derive" // derive a new conversation (conversation derivation action / custom action)
  | "lesson"; // focused lesson (lesson teacher)

// Metadata for agent library display (end users see "what this capability does / when it runs / what it reads/writes", not hooks/schema).
export interface AgentCard {
  title: string;
  description: string;
  entry: AgentEntry; // entry group (how to use / when it appears)
  timing: string; // when it runs
  reads: string; // what data it can read
  writes: string; // whether it will propose writing to learning memory
  canDisable: boolean; // main reply cannot be disabled; observers / actions can be
}

// One catalog entry exported by the registry to the agent library.
export interface AgentCatalogEntry {
  id: string;
  kind: AgentKind;
  enabled: boolean;
  scope?: ActionScope;
  card?: AgentCard;
}

export type ConversationKind = "practice" | "learning_agent";

export interface Langs {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
}

// Callbacks pushed back to the UI when the main reply completes / correction arrives (orchestrator's TurnCallbacks has this shape).
export interface ConversationCallbacks {
  onReplyDelta: (delta: string) => void;
  /** Triggered when the conversation stream ends and the user can continue typing; correction is still running in the background. */
  onReplyComplete?: (reply: string) => void;
  onAnalysis: (
    analysis: TutorAnalysis | null,
    opts?: { error?: string; proseFeedback?: string },
  ) => void;
}

// Shared context for both conversation kinds. All DB queries are resolved in the orchestrator and passed in; agents only read, never query.
interface BaseContext {
  provider: ModelProvider;
  conversationId: string;
  /** Current turn id (passed from UI or generated locally); observer writes back to this turn. */
  turnId: string;
  userInput: string;
  /** App-triggered hidden kickoff for an empty derived conversation. */
  openingInstruction?: string;
  langs: Langs;
  summary: string;
  history: string;
  callbacks: ConversationCallbacks;
  /** Resolves once the turn row is persisted (= safe to write analysis_json); rejects if persistence fails.
   *  Observers wait for this before writing back, to avoid writing to a non-existent row. */
  turnPersisted: Promise<string>;
}

export interface PracticeContext extends BaseContext {
  kind: "practice";
  profileSlice: string;
  conversationPreferences: string;
  tutorPreferences: string;
  tutorFlags: CorrectionPreferenceFlags;
  /** Tutor only sees the most recent few turns; conversation sees all verbatim turns after the watermark. */
  tutorHistory: string;
  weakList: WeakItem[];
  keyHints: MasteryKeyHint[];
  comfortableItems: ComfortableItem[];
  reviewItems: ReviewItem[];
  proficiency: ProficiencySnapshot;
  /** Session-level adjustments (difficulty/role/next-day from branches); empty object for normal conversations. */
  agentModifiers: AgentModifiers;
}

export interface LearningContext extends BaseContext {
  kind: "learning_agent";
  experiencePreferences: string;
  agentName: string;
  agentPrompt: string;
  dataContext: string;
  kickoff: boolean;
}

export type ConversationContext = PracticeContext | LearningContext;

// reply_producer: unique per conversation by kind, streams the main reply.
export interface ReplyProducer {
  id: string;
  kind: "reply_producer";
  conversationKind: ConversationKind;
  card?: AgentCard;
  run: (
    ctx: ConversationContext,
    onDelta: (delta: string) => void,
  ) => Promise<string>;
}

// observer: runs in parallel with the main reply, produces structured signals and handles code bookkeeping itself (LLM does not touch counts).
// Phase 1 only runs on the practice hot path, so only PracticeContext is seen.
export interface Observer {
  id: string;
  kind: "observer";
  card?: AgentCard;
  run: (ctx: PracticeContext) => Promise<void>;
}

// action (conversation.action hook): user-click-triggered conversation actions (branch, swap roles, adjust difficulty, etc.).
// scope="session" affects the entire conversation (rendered in the action bar); "turn" affects a specific turn (rendered on that turn's buttons).
// Most actions are just "code creates a branch + injects modifiers"; run returns the new conversation id to navigate to.
export type ActionScope = "session" | "turn";

export interface ActionContext {
  conversationId: string;
  sourceTurnId?: string;
}

export interface DerivationContext {
  newConversationId: string;
  sourceConversationId: string;
  sourceTurnId?: string | null;
}

export interface ActionResult {
  /** Id of the newly created branch conversation; UI navigates to it. */
  navigateTo?: string;
}

export interface ActionAgent {
  id: string;
  kind: "action";
  scope: ActionScope;
  label: string;
  description?: string;
  branchKind?: BranchKind;
  baseModifiers?: AgentModifiers;
  card?: AgentCard;
  /** Conversation derivation actions create a pending conversation first, then generate context on that page. */
  deriveContext?: (ctx: DerivationContext) => Promise<NewConversationContext>;
  /** Legacy/non-derivation actions, e.g. turning a conversation into a lesson. */
  run?: (ctx: ActionContext) => Promise<ActionResult>;
}

// On-demand transformers (explain / bilingual / selection): run directly at the call site by the orchestrator + logged via runLogged,
// not dispatched through the hot path. Only metadata is registered here for agent library display (always available, no toggle).
export interface TransformerInfo {
  id: string;
  card: AgentCard;
}
