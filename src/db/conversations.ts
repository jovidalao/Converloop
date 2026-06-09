import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "./client";
import { type Conversation, conversation, turn } from "./schema";

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

// Rapid-fire Q&A drill: the learner sets one umbrella scenario, the reply agent invents a fresh micro-prompt each
// turn — rotating task types (respond / describe / narrate / explain / opinion), not only "respond" (see
// formatModifierInstructions). Still a practice-kind conversation, so tutor correction / mastery / coach all run.
export interface QuickfireModifiers {
  scenario: string;
}

// Dictation drill: the conversation agent presents one sentence per turn (spoken aloud by the UI, its text hidden via
// the [[SAY]] tags until the learner answers), gives brief feedback on the previous transcription, then the next
// sentence. A practice-kind conversation reshaped by this marker via formatModifierInstructions — the tutor still
// grades each transcription as usual. Theme is the only thing carried here.
export interface DictationModifiers {
  theme: string;
}

// Session-level adjustments: behavior changes the reply agent should follow. LLM observes; behavior is injected by code (formatted as instructions).
export interface AgentModifiers {
  difficultyDelta?: number; // +1 harder / -1 easier
  swapRoles?: boolean;
  nextDay?: boolean;
  note?: string; // free-form supplementary instruction
  derivation?: ConversationDerivationState;
  derivedContext?: NewConversationContext;
  quickfire?: QuickfireModifiers;
  dictation?: DictationModifiers;
}

export function parseAgentModifiers(json: string | null): AgentModifiers {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as AgentModifiers;
    }
  } catch {
    // Corrupted JSON falls back to no adjustments
  }
  return {};
}

// The user-facing type of a conversation, used to badge each history row with an icon. Quickfire and dictation are
// both practice-kind rows distinguished only by their modifier; everything else practice-kind is a plain conversation.
export type ConversationType =
  | "practice"
  | "quickfire"
  | "dictation"
  | "learning_agent";

export function conversationType(c: ConversationMeta): ConversationType {
  if (c.kind === "learning_agent") return "learning_agent";
  const mods = parseAgentModifiers(c.agentModifiersJson);
  if (mods.quickfire) return "quickfire";
  if (mods.dictation) return "dictation";
  return "practice";
}

// Convert session-level adjustments into English instructions fed to the conversation agent; returns empty string when there are no adjustments.
export function formatModifierInstructions(mods: AgentModifiers): string {
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
  if (mods.quickfire?.scenario.trim()) {
    lines.push(`- RAPID-FIRE Q&A DRILL — this overrides the default "keep a flowing conversation" behavior.
  Umbrella scenario the learner chose: "${mods.quickfire.scenario.trim()}".
  Run a fast, energetic drill. Every turn, invent ONE fresh, specific micro-prompt that fits this umbrella scenario for the learner to speak to in the target language. VARY the task type across turns — do NOT make every prompt "reply to what someone said". Rotate among:
    (a) RESPOND — react to / handle a concrete situation (someone says or does something);
    (b) DESCRIBE — describe an object, place, person, or what they're seeing in the scene;
    (c) NARRATE — recount what just happened, or a related experience ("tell them about the time…");
    (d) EXPLAIN — explain how or why (how they'd do something, why something went wrong);
    (e) OPINION — give a quick opinion or preference with a reason.
  KEEP THE WHOLE PROMPT IN THE TARGET LANGUAGE — scene, set-up, and the ask — calibrated to the learner's level so it reads at a glance; they perform the task OUT LOUD in the target language. (The app has a bilingual reading mode the learner can toggle for a native-language gloss, so do NOT mix in their native language yourself — a monolingual target-language message is what renders cleanly.) When you set the scene, do NOT spell out the exact words or phrases the ideal answer needs — paint the SITUATION and let them produce the language themselves, so it stays a real production challenge rather than a copying task.
  Make every micro-prompt vivid and fun: open with a fitting emoji and sprinkle a few more through the scene (e.g. 🛬 🧾 🙇 😬 ⏰ 🛒 🤝) so it reads like a lively flash card rather than a dry exam question. Keep it to one or two punchy sentences, clearly different from the previous prompts in BOTH task type and content — do NOT build a continuous storyline.
  After the learner answers, your next message has TWO short parts: FIRST a brief model answer in the target language showing one natural way to do the task they just attempted (handle / describe / narrate / explain / etc., one or two sentences, introduced with a short lead-in); keep the model answer itself clean and natural, no need to load it with emoji. THEN immediately present the NEXT prompt (target-language scene + emoji, as above). Keep the whole turn short and energetic.
  Do NOT correct or critique the learner's answer — another agent handles that. Do NOT chit-chat or ask how they are doing; just model, then next prompt.`);
  }
  if (mods.dictation) {
    const theme = mods.dictation.theme.trim() || "everyday life";
    lines.push(`- DICTATION DRILL — this overrides the default "keep a flowing conversation" behavior.
  Theme the learner chose: "${theme}".
  You are running a LISTENING DICTATION. Each turn you present ONE sentence for the learner to transcribe by ear; they type exactly what they hear. The app SPEAKS your sentence aloud and HIDES its text until they answer.
  STRICT OUTPUT FORMAT — follow it on EVERY turn:
    • If the learner just submitted a transcription, FIRST write a brief note in the learner's NATIVE language (1–3 short lines): whether they got it, the exact words they missed or misheard, and one quick listening tip. Do NOT restate the full correct sentence — the app reveals it automatically — and do not enumerate every spelling slip (a separate grader marks the transcription precisely); keep it to an encouraging, human read of how they did.
    • THEN, as the LAST thing in your message, output the next sentence to dictate wrapped EXACTLY as: ${DICTATION_SAY_OPEN}the sentence${DICTATION_SAY_CLOSE} with nothing after the closing tag.
  The text inside ${DICTATION_SAY_OPEN}…${DICTATION_SAY_CLOSE} MUST be a single, complete, natural sentence in the TARGET language, calibrated to the learner's level, fitting the theme, and clearly different from earlier ones. Put ONLY that sentence between the tags. NEVER write the upcoming sentence anywhere except inside the tags, and never describe it in advance.`);
  }
  if (mods.note?.trim()) lines.push(`- ${mods.note.trim()}`);
  return lines.join("\n");
}

// Opening instruction for the AI's first turn of a rapid-fire drill: present the first prompt only, no model answer yet.
export const QUICKFIRE_OPENING_INSTRUCTION =
  "Start the rapid-fire Q&A drill now. Present the FIRST prompt within the umbrella scenario for the learner — it can be a situation to handle, or something to describe, narrate, or explain. Follow the drill rules: keep the prompt in the target language (calibrated to their level) with a fitting emoji. Do not give a model answer yet — there is nothing to model on the first turn.";

// Sentinel tags wrapping the sentence to dictate in a dictation reply. The agent is instructed to emit the
// to-be-transcribed sentence (and only that) between these, so the UI can hide its text and speak it on its own while
// still showing any feedback that precedes it. Kept here so the agent contract and the UI parser share one definition.
export const DICTATION_SAY_OPEN = "[[SAY]]";
export const DICTATION_SAY_CLOSE = "[[/SAY]]";

// Opening instruction for the AI's first turn of a dictation drill: just the first sentence, wrapped, no preamble.
export const DICTATION_OPENING_INSTRUCTION = `Start the dictation drill now. Output ONLY the first sentence to dictate, wrapped exactly as ${DICTATION_SAY_OPEN}the sentence${DICTATION_SAY_CLOSE} — no greeting, no preamble, nothing before or after the tags.`;

export interface DictationReplyParts {
  /** Feedback on the learner's previous transcription (shown). Empty on the opening turn. */
  feedback: string;
  /** The sentence to dictate (spoken; hidden until answered). Falls back to the whole reply if the agent omits the tags. */
  sentence: string;
}

// Split a dictation reply into the visible feedback and the to-dictate sentence. When the agent omits the sentinel we
// treat the whole reply as the sentence (so the text is never accidentally revealed), with no feedback.
export function parseDictationReply(reply: string): DictationReplyParts {
  const open = reply.indexOf(DICTATION_SAY_OPEN);
  const close = reply.indexOf(
    DICTATION_SAY_CLOSE,
    open + DICTATION_SAY_OPEN.length,
  );
  if (open >= 0 && close > open) {
    const sentence = reply
      .slice(open + DICTATION_SAY_OPEN.length, close)
      .trim();
    return { feedback: reply.slice(0, open).trim(), sentence };
  }
  return { feedback: "", sentence: reply.trim() };
}

// The portion of a still-streaming dictation reply that is safe to show: everything before the sentinel begins (the
// feedback). Cuts at the first "[[" so a partial "[[SAY" tag never leaks the hidden sentence.
export function streamingDictationFeedback(streamed: string): string {
  const i = streamed.indexOf("[[");
  return (i >= 0 ? streamed.slice(0, i) : streamed).trim();
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

// Most recently active first (updated_at descending), for the sidebar list.
export async function listConversations(): Promise<ConversationMeta[]> {
  return db.select().from(conversation).orderBy(desc(conversation.updatedAt));
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

// Create a rapid-fire Q&A conversation: a normal practice conversation (tutor / mastery / coach all apply) whose
// reply agent is reshaped into a drill via the quickfire modifier. The AI opens with the first situation (see
// startQuickfireSession), so the title is seeded from the umbrella scenario rather than a first user message.
export async function createQuickfireConversation(
  scenario: string,
  id: string = crypto.randomUUID(),
): Promise<string> {
  const now = Date.now();
  const modifiers: AgentModifiers = {
    quickfire: { scenario: scenario.trim() },
  };
  await db.insert(conversation).values({
    id,
    title: titleFromInput(scenario),
    createdAt: now,
    updatedAt: now,
    kind: "practice",
    learningAgentId: null,
    agentModifiersJson: JSON.stringify(modifiers),
  });
  return id;
}

// Create a dictation drill conversation: a practice-kind row carrying the dictation marker (theme). The drill UI reads
// the theme from the modifier to generate level-appropriate sentences; there is no AI "opening" turn — the first
// sentence is synthesized and spoken on the start page, and only answered items are persisted as turns.
export async function createDictationConversation(
  theme: string,
  id: string = crypto.randomUUID(),
): Promise<string> {
  const now = Date.now();
  const modifiers: AgentModifiers = {
    dictation: { theme: theme.trim() },
  };
  await db.insert(conversation).values({
    id,
    title: titleFromInput(theme),
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

// Delete a conversation along with all its turns. Mastery/profile is global, not handled here.
export async function deleteConversation(id: string): Promise<void> {
  await db.delete(turn).where(eq(turn.conversationId, id));
  await db.delete(conversation).where(eq(conversation.id, id));
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
