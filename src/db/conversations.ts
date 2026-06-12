import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { BUILTIN_DRILL_IDS, getBuiltinDrillSeed } from "../drills/builtins";
import type {
  DrillConversationModifier,
  DrillDefinition,
  DrillParams,
  ReviewDrillItem,
} from "../drills/types";
import { deleteAppState } from "./app-state";
import { db } from "./client";
import {
  agentJob,
  type Conversation,
  conversation,
  memoryProposal,
  turn,
  turnAnnotation,
} from "./schema";

// The say sentinel + parsers moved to the drills module (one definition shared by the agent contract
// and the UI); re-exported here so existing call sites keep working.
export {
  DICTATION_SAY_CLOSE,
  DICTATION_SAY_OPEN,
  type DictationReplyParts,
  parseDictationReply,
  streamingDictationFeedback,
} from "../drills/say";
export type { DrillConversationModifier, DrillParams, ReviewDrillItem };

export type ConversationMeta = Conversation;
export type ConversationKind = Conversation["kind"];

// Conversation branching (Phase 3). Branching is a non-destructive action: derives a new conversation from the source; source remains unchanged.
export type BranchKind =
  | "branch_from"
  | "restart"
  | "harder"
  | "easier"
  | "swap_roles"
  | "next_day"
  | "change_scene"
  | "custom_action";

export const BRANCH_KIND_LABEL: Record<BranchKind, string> = {
  branch_from: "Branch",
  restart: "Restart",
  harder: "Harder",
  easier: "Easier",
  swap_roles: "Swap roles",
  next_day: "Next day",
  change_scene: "Change scene",
  custom_action: "Custom action",
};

export interface NewConversationContext {
  title: string;
  scenario: string;
  userRole: string;
  aiRole: string;
  difficulty: string;
  continuitySummary: string;
  openingInstruction: string;
  constraints: string[];
}

export interface ConversationDerivationState {
  actionId: string;
  actionLabel: string;
  status: "pending" | "ready" | "failed";
  sourceTurnId?: string | null;
  createdAt: number;
  completedAt?: number;
  error?: string | null;
}

// Session-level adjustments: behavior changes the reply agent should follow. LLM observes; behavior is injected by code (formatted as instructions).
// Drill conversations carry one generic `drill` modifier ({ modeId, params, def snapshot }); the
// legacy per-drill keys (quickfire/dictation/shadowing/reviewDrill) are normalized into it at parse time.
export interface AgentModifiers {
  difficultyDelta?: number; // +1 harder / -1 easier
  swapRoles?: boolean;
  nextDay?: boolean;
  note?: string; // free-form supplementary instruction
  derivation?: ConversationDerivationState;
  derivedContext?: NewConversationContext;
  drill?: DrillConversationModifier;
}

// Legacy modifier JSON (pre-drill@1 rows): each built-in drill had its own marker key. Normalized to
// the generic drill modifier on read; stored rows are not rewritten.
interface LegacyDrillModifiers {
  quickfire?: { scenario: string };
  dictation?: { theme: string };
  shadowing?: { theme: string };
  reviewDrill?: { items: ReviewDrillItem[] };
}

function legacyDrillModifier(
  raw: LegacyDrillModifiers,
): DrillConversationModifier | undefined {
  const make = (
    modeId: string,
    params: DrillParams,
  ): DrillConversationModifier | undefined => {
    const seed = getBuiltinDrillSeed(modeId);
    return seed ? { modeId, params, def: seed.def } : undefined;
  };
  if (raw.quickfire) {
    return make(BUILTIN_DRILL_IDS.quickfire, { setup: raw.quickfire.scenario });
  }
  if (raw.dictation) {
    return make(BUILTIN_DRILL_IDS.dictation, { setup: raw.dictation.theme });
  }
  if (raw.shadowing) {
    return make(BUILTIN_DRILL_IDS.shadowing, { setup: raw.shadowing.theme });
  }
  if (raw.reviewDrill) {
    return make(BUILTIN_DRILL_IDS.reviewDrill, {
      items: raw.reviewDrill.items ?? [],
    });
  }
  return undefined;
}

export function parseAgentModifiers(json: string | null): AgentModifiers {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const mods = raw as AgentModifiers & LegacyDrillModifiers;
      if (!mods.drill) {
        const drill = legacyDrillModifier(mods);
        if (drill) return { ...mods, drill };
      }
      return mods;
    }
  } catch {
    // Corrupted JSON falls back to no adjustments
  }
  return {};
}

// The user-facing type of a conversation, used to badge each history row with an icon. Drill rows are
// practice-kind rows distinguished only by their modifier; custom drills map onto the closest built-in
// family via their interaction/setup preset (the icon, not the behavior).
export type ConversationType =
  | "practice"
  | "quickfire"
  | "dictation"
  | "shadowing"
  | "review_drill"
  | "learning_agent";

export function conversationType(c: ConversationMeta): ConversationType {
  if (c.kind === "learning_agent") return "learning_agent";
  const drill = parseAgentModifiers(c.agentModifiersJson).drill;
  if (!drill) return "practice";
  if (drill.def.setup === "review-items") return "review_drill";
  if (drill.def.interaction === "say-hidden") return "dictation";
  if (drill.def.interaction === "say-visible") return "shadowing";
  return "quickfire";
}

// Per-turn dynamic extras layered onto the modifier instructions by the orchestrator (the modifiers
// themselves are static per conversation; these change every turn). Drill-specific extras (listening
// focus words, replay pacing) live in drills/render.ts; redoNote applies to any conversation.
export interface ModifierInstructionExtras {
  /** "Say it again": the latest message re-produces the learner's corrected previous sentence from memory. */
  redoNote?: string;
  /** Pre-rendered drill instruction block (drills/render.ts), appended after the generic adjustments. */
  drillBlock?: string;
}

// Convert session-level adjustments into English instructions fed to the conversation agent; returns empty string when there are no adjustments.
export function formatModifierInstructions(
  mods: AgentModifiers,
  extras: ModifierInstructionExtras = {},
): string {
  const lines: string[] = [];
  if (mods.difficultyDelta && mods.difficultyDelta > 0)
    lines.push(
      "- Push the difficulty noticeably HIGHER than this learner's usual level: longer, richer, more idiomatic sentences that stretch them, while staying just within reach.",
    );
  if (mods.difficultyDelta && mods.difficultyDelta < 0)
    lines.push(
      "- EASE the difficulty below this learner's usual level: shorter sentences, high-frequency vocabulary, one idea at a time.",
    );
  if (mods.swapRoles)
    lines.push(
      "- Swap conversational roles: let the LEARNER lead and ask the questions; you mostly respond and follow their lead, nudging them to drive the exchange.",
    );
  if (mods.nextDay)
    lines.push(
      "- This conversation resumes an earlier one on a NEW DAY. Open with a brief, natural reconnection (a greeting or callback to before), then carry on — do not restart from scratch.",
    );
  if (mods.derivedContext) {
    const ctx = mods.derivedContext;
    lines.push(`- This is a derived conversation. Use the generated context below as the source of truth for this new conversation. Do not mention that it was generated, and do not recap it as a list.
  Title: ${ctx.title}
  Scenario: ${ctx.scenario}
  Learner role: ${ctx.userRole}
  AI role: ${ctx.aiRole}
  Difficulty: ${ctx.difficulty}
  Continuity summary: ${ctx.continuitySummary || "(none)"}
  Opening instruction: ${ctx.openingInstruction}
  Constraints: ${
    ctx.constraints.length > 0 ? ctx.constraints.join(" / ") : "(none)"
  }`);
  }
  if (extras.drillBlock?.trim()) lines.push(extras.drillBlock.trim());
  if (mods.note?.trim()) lines.push(`- ${mods.note.trim()}`);
  if (extras.redoNote) lines.push(`- ${extras.redoNote}`);
  return lines.join("\n");
}

// Placeholder title for new conversations; ChatView changes it to truncated input content after the first message is sent (ChatGPT style).
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

const ACTIVE_KEY = "lang-agent.activeConversation";

export function getActiveConversationId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveConversationId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function clearActiveConversationId(): void {
  localStorage.removeItem(ACTIVE_KEY);
}

// Pinned first, then most recently active (updated_at descending), for the sidebar list.
export async function listConversations(): Promise<ConversationMeta[]> {
  return db
    .select()
    .from(conversation)
    .orderBy(desc(conversation.pinned), desc(conversation.updatedAt));
}

// Sidebar pin/unpin. Pinned conversations sort above the recency list and never sink.
export async function setConversationPinned(
  id: string,
  pinned: boolean,
): Promise<void> {
  await db
    .update(conversation)
    .set({ pinned: pinned ? 1 : 0 })
    .where(eq(conversation.id, id));
}

export async function getConversation(
  id: string,
): Promise<ConversationMeta | null> {
  const [row] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  return row ?? null;
}

export async function createConversation(
  title: string = DEFAULT_CONVERSATION_TITLE,
  id: string = crypto.randomUUID(),
  opts: { kind?: ConversationKind; learningAgentId?: string | null } = {},
): Promise<string> {
  const now = Date.now();
  await db.insert(conversation).values({
    id,
    title: title.trim() || DEFAULT_CONVERSATION_TITLE,
    createdAt: now,
    updatedAt: now,
    kind: opts.kind ?? "practice",
    learningAgentId: opts.learningAgentId ?? null,
  });
  return id;
}

// Create a drill conversation: a practice-kind row carrying the generic drill modifier — a live
// reference (modeId) for prompt resolution (edits to the drill propagate) plus a full definition
// snapshot (mechanics never morph mid-session; conversations survive drill deletion). The AI opens
// the session via startDrillSession; learner answers then go through the normal graded runTurn.
export async function createDrillConversation(
  drill: { id: string; def: DrillDefinition },
  params: DrillParams,
  opts: { title?: string; id?: string } = {},
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  const now = Date.now();
  const modifiers: AgentModifiers = {
    drill: {
      modeId: drill.id,
      params: {
        setup: params.setup?.trim() || undefined,
        items: params.items,
      },
      def: drill.def,
    },
  };
  const title =
    opts.title?.trim() ||
    (params.setup?.trim()
      ? titleFromInput(params.setup)
      : titleFromInput(drill.def.name));
  await db.insert(conversation).values({
    id,
    title,
    createdAt: now,
    updatedAt: now,
    kind: "practice",
    learningAgentId: null,
    agentModifiersJson: JSON.stringify(modifiers),
  });
  return id;
}

export async function createPendingDerivedConversation(opts: {
  parentId: string;
  actionId: string;
  actionLabel: string;
  branchKind: BranchKind;
  sourceTurnId?: string | null;
  baseModifiers?: AgentModifiers;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const modifiers: AgentModifiers = {
    ...(opts.baseModifiers ?? {}),
    derivation: {
      actionId: opts.actionId,
      actionLabel: opts.actionLabel,
      status: "pending",
      sourceTurnId: opts.sourceTurnId ?? null,
      createdAt: now,
    },
  };
  await db.insert(conversation).values({
    id,
    title: `${opts.actionLabel} · generating`,
    createdAt: now,
    updatedAt: now,
    kind: "practice",
    learningAgentId: null,
    parentConversationId: opts.parentId,
    branchSourceTurnId: opts.sourceTurnId ?? null,
    branchKind: opts.branchKind,
    agentModifiersJson: JSON.stringify(modifiers),
  });
  // Derivation is a non-destructive action: the source conversation is unchanged, do not update its modified time / sort order.
  return id;
}

export async function completeDerivedConversation(
  id: string,
  context: NewConversationContext,
): Promise<void> {
  const conv = await getConversation(id);
  const modifiers = parseAgentModifiers(conv?.agentModifiersJson ?? null);
  const now = Date.now();
  await db
    .update(conversation)
    .set({
      title: context.title.trim() || conv?.title || DEFAULT_CONVERSATION_TITLE,
      updatedAt: now,
      agentModifiersJson: JSON.stringify({
        ...modifiers,
        derivedContext: context,
        derivation: modifiers.derivation
          ? {
              ...modifiers.derivation,
              status: "ready",
              completedAt: now,
              error: null,
            }
          : undefined,
      } satisfies AgentModifiers),
    })
    .where(eq(conversation.id, id));
}

export async function failDerivedConversation(
  id: string,
  error: string,
): Promise<void> {
  const conv = await getConversation(id);
  const modifiers = parseAgentModifiers(conv?.agentModifiersJson ?? null);
  // Update title to "… · generation failed" to prevent the sidebar from being stuck at "generating".
  const label = modifiers.derivation?.actionLabel ?? "derived conversation";
  await db
    .update(conversation)
    .set({
      title: `${label} · generation failed`,
      updatedAt: Date.now(),
      agentModifiersJson: JSON.stringify({
        ...modifiers,
        derivation: modifiers.derivation
          ? { ...modifiers.derivation, status: "failed", error }
          : undefined,
      } satisfies AgentModifiers),
    })
    .where(eq(conversation.id, id));
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<void> {
  await db
    .update(conversation)
    .set({ title: title.trim() || DEFAULT_CONVERSATION_TITLE })
    .where(eq(conversation.id, id));
}

// Push updated_at to now so the conversation where a message was just sent sorts to the top.
export async function touchConversation(id: string): Promise<void> {
  await db
    .update(conversation)
    .set({ updatedAt: Date.now() })
    .where(eq(conversation.id, id));
}

// Rolling summary read/write (for auto-compression). summary is a target-language summary of older conversation content;
// throughId is the last turn.id folded into the summary (watermark). Maintained by code; LLM only produces the summary text.
export async function getSummary(
  id: string,
): Promise<{ summary: string | null; throughId: string | null }> {
  const [row] = await db
    .select({
      summary: conversation.summary,
      throughId: conversation.summaryThroughId,
    })
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  return { summary: row?.summary ?? null, throughId: row?.throughId ?? null };
}

export async function setSummary(
  id: string,
  summary: string,
  throughId: string,
): Promise<void> {
  await db
    .update(conversation)
    .set({ summary, summaryThroughId: throughId })
    .where(eq(conversation.id, id));
}

// "Start from here": discard all turns in a conversation starting from fromId (inclusive) — everything after that point is dropped.
// Only turns are deleted: mastery/profile is globally and independently stored, not handled here — content already recorded in learning memory is preserved.
// If the deleted range crosses the rolling summary watermark (throughId is also deleted), clear the summary so context rebuilds from the remaining verbatim turns.
export async function truncateConversationFrom(
  id: string,
  fromId: string,
): Promise<void> {
  const [mark] = await db
    .select({ createdAt: turn.createdAt })
    .from(turn)
    .where(eq(turn.id, fromId))
    .limit(1);
  if (!mark) return;
  const dropped = (
    await db
      .select({ id: turn.id })
      .from(turn)
      .where(
        and(eq(turn.conversationId, id), gte(turn.createdAt, mark.createdAt)),
      )
  ).map((r) => r.id);
  await cleanupTurnArtifacts(dropped);
  await db
    .delete(turn)
    .where(
      and(eq(turn.conversationId, id), gte(turn.createdAt, mark.createdAt)),
    );

  const [conv] = await db
    .select({ throughId: conversation.summaryThroughId })
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  if (!conv?.throughId) return;
  const [stillThere] = await db
    .select({ id: turn.id })
    .from(turn)
    .where(eq(turn.id, conv.throughId))
    .limit(1);
  if (!stillThere) {
    await db
      .update(conversation)
      .set({ summary: null, summaryThroughId: null })
      .where(eq(conversation.id, id));
  }
}

// Per-turn artifacts that would otherwise be orphaned when turns are deleted: custom-observer
// annotations, pending write proposals, and hot-path run logs all hang off turn_id. mastery_event
// is deliberately NOT cleaned — it is the permanent evidence log behind mastery counts.
async function cleanupTurnArtifacts(turnIds: string[]): Promise<void> {
  // SQLite caps bound parameters (999); chunk to stay well under it.
  for (let i = 0; i < turnIds.length; i += 200) {
    const chunk = turnIds.slice(i, i + 200);
    await db
      .delete(turnAnnotation)
      .where(inArray(turnAnnotation.turnId, chunk));
    await db
      .delete(memoryProposal)
      .where(inArray(memoryProposal.turnId, chunk));
    await db.delete(agentJob).where(inArray(agentJob.turnId, chunk));
  }
}

// Delete a conversation along with all its turns and the per-turn artifacts hanging off them.
// Mastery/profile is global, not handled here; mastery_event evidence is kept. Child branches keep
// their content but drop the dangling parent pointer.
export async function deleteConversation(id: string): Promise<void> {
  const ids = (
    await db
      .select({ id: turn.id })
      .from(turn)
      .where(eq(turn.conversationId, id))
  ).map((r) => r.id);
  await cleanupTurnArtifacts(ids);
  await db.delete(turn).where(eq(turn.conversationId, id));
  await db.delete(conversation).where(eq(conversation.id, id));
  // Cached input hints for this conversation (app_state) are now stale garbage.
  await deleteAppState(`inputHints:${id}`);
  // Children of this conversation would point at a missing parent; drop the lineage pointer.
  await db
    .update(conversation)
    .set({ parentConversationId: null })
    .where(eq(conversation.parentConversationId, id));
}

// Called at startup: returns the conversation id to activate. Returns null when there is no history; the frontend then displays an unsaved new conversation draft.
// Legacy turns from before multi-conversation support (conversation_id = NULL) are still archived into a default conversation.
export async function ensureActiveConversation(): Promise<string | null> {
  let convs = await listConversations();

  if (convs.length === 0) {
    const orphanCount = await countOrphanTurns();
    if (orphanCount === 0) {
      clearActiveConversationId();
      return null;
    }

    const id = await createConversation(DEFAULT_CONVERSATION_TITLE);
    const adopted = await adoptOrphanTurns(id);
    if (adopted > 0) {
      // Legacy history: use the first input as the title and align the time to the last turn.
      const first = await firstOrphanAdoptedUserInput(id);
      if (first) await renameConversation(id, titleFromInput(first));
    }
    convs = await listConversations();
  }

  const saved = getActiveConversationId();
  if (saved && convs.some((c) => c.id === saved)) return saved;

  if (convs.length === 0) {
    clearActiveConversationId();
    return null;
  }

  const active = convs[0].id; // most recently active conversation
  setActiveConversationId(active);
  return active;
}

async function countOrphanTurns(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(turn)
    .where(isNull(turn.conversationId));
  return row?.n ?? 0;
}

// Archive all turns with conversation_id = NULL into the specified conversation. Returns the number archived.
async function adoptOrphanTurns(conversationId: string): Promise<number> {
  const n = await countOrphanTurns();
  if (n > 0) {
    await db
      .update(turn)
      .set({ conversationId })
      .where(isNull(turn.conversationId));
  }
  return n;
}

async function firstOrphanAdoptedUserInput(
  conversationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userInput: turn.userInput })
    .from(turn)
    .where(eq(turn.conversationId, conversationId))
    .orderBy(turn.createdAt)
    .limit(1);
  return row?.userInput ?? null;
}

// Auto-title after the first message: only updates if the title is still the placeholder (user-edited titles are left alone).
export async function maybeAutoTitle(
  id: string,
  userInput: string,
): Promise<void> {
  const [row] = await db
    .select({ title: conversation.title })
    .from(conversation)
    .where(eq(conversation.id, id))
    .limit(1);
  if (row && row.title === DEFAULT_CONVERSATION_TITLE) {
    await renameConversation(id, titleFromInput(userInput));
  }
}

// Derive conversation title from the user's first input: collapse whitespace and truncate.
export function titleFromInput(text: string, max = 30): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_CONVERSATION_TITLE;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
