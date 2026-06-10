import type { ComfortableItem, ReviewItem } from "../db/mastery";
import { estimatePromptTokens } from "../lib/tokens";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";
import { buildHistoryMessages, type HistoryTurn } from "./history-messages";

export interface ConversationContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  profileSlice: string; // MD profile slice (placeholder before Task 7)
  experiencePreferences: string; // experience preferences explicitly configured by the user on the settings page
  comfortableItems: ComfortableItem[]; // mastered items, usable as explanation/conversation scaffolds
  reviewItems: ReviewItem[]; // review candidates selected by code for natural reuse (see db/mastery getReviewDueList)
  calibrationHint: string; // evidence-driven difficulty calibration (see lib/proficiency; empty when insufficient evidence)
  sessionAdjustments: string; // session-level adjustment instructions (difficulty/role/next-day from branches; empty if none)
  summary: string; // rolling summary: target-language recap of earlier content (auto-compressed; empty if none)
  historyTurns: HistoryTurn[]; // verbatim recent turns, sent as real alternating user/assistant messages
  userInput: string;
  openingInstruction?: string; // hidden opening instruction triggered by the app (conversation derivation)
  standaloneQuestion?: boolean; // /btw side question: answer this message without surrounding conversation context
  customInstructions?: string; // additional instructions appended by the user in the agent library
}

// Collapse whitespace and truncate to max characters, to prevent overly long examples from bloating the hot-path prompt (consistent with learning-data).
function oneLine(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function formatReviewItems(items: ReviewItem[]): string {
  if (items.length === 0) return "(nothing due)";
  return items
    .map((r) => {
      const example =
        r.type === "expression_gap" && r.notes ? r.notes : r.example;
      return example
        ? `- ${r.label} — e.g. "${oneLine(example, 140)}"`
        : `- ${r.label}`;
    })
    .join("\n");
}

function formatComfortableItems(items: ComfortableItem[]): string {
  if (items.length === 0) return "(none yet)";
  return items
    .map((item) => {
      const example =
        item.type === "expression_gap" && item.notes
          ? item.notes
          : item.example;
      return example
        ? `- ${item.label} — e.g. "${oneLine(example, 120)}"`
        : `- ${item.label}`;
    })
    .join("\n");
}

// See docs/conversation-agent.md#system-prompt
// The system prompt is split into three system messages ordered stable-first so providers can
// prefix-cache it (the Anthropic adapter puts a cache breakpoint on every block except the last;
// OpenAI-style providers re-join them, where automatic prefix caching also profits from this order):
//   1. stable rules — depends only on the language config
//   2. slow-changing learner context — preferences + MD profile (changes when the maintainer runs)
//   3. per-turn dynamic data — calibration, ranked scaffold/review lists, session adjustments, summary
function stableRulesPrompt(ctx: ConversationContext): string {
  return `You are a warm, natural conversation partner for a ${ctx.nativeLanguage} speaker
learning ${ctx.targetLanguage} at roughly ${ctx.level} level. Your only job here is to
keep the conversation flowing — another agent handles correction and feedback.

RULES
- Respond IN ${ctx.targetLanguage}, calibrated to ${ctx.level}: slightly stretch the user,
  never overwhelm them.
- Follow the learner experience preferences below for language variety, spelling,
  phrasing, tone, and other standing requests.
- Respond to what the user MEANS. Do NOT correct their mistakes and do NOT echo
  their wording if it might be wrong — rephrase into natural, idiomatic language
  so they absorb the correct form implicitly.
- The learner profile below starts with "About me" — durable personal facts about
  the user (their job, studies, life situation). Treat these as things you already
  know about them: reference them naturally when relevant so it feels like you
  remember the person, but never interrogate or recite them back as a list.
- The profile also lists what they're working on, what they're comfortable with,
  what they avoid, their interests, and recently learned items — use them to gauge
  what is easy or hard for this person.
- Below the profile is a short COMFORTABLE WITH list selected from confirmed
  known items. Use these as safe scaffolds when explaining or stretching the
  learner, and avoid reteaching them as if they were new.
- Below the profile is a short DUE-FOR-REVIEW list the app selected: things the
  learner met before but hasn't practiced lately. Where it fits naturally, work
  ONE (at most two) into the conversation — this is how review happens. Alternate
  between two modes: sometimes MODEL the item by using it yourself so they see it
  again; sometimes ELICIT it by asking a question or steering the topic so that a
  natural answer requires the item — active recall beats re-reading, so prefer
  eliciting when the moment allows. Keep it subtle, never announce or name the
  item, and skip it entirely if nothing fits the moment.
- If the profile ends with "My notes", those are notes the user wrote themselves:
  reminders, standing requests, or facts they want you to keep in mind. Treat them
  as the user's own instructions — honor them and weave the facts in naturally,
  just like About me. Never recite them back as a list.
- Pick topics aligned with their interests when you have the freedom to.
- End with a light follow-up question when it helps keep them talking.
- Keep it to a natural chat length. You may use light Markdown (bold, italics,
  bullet lists) when it genuinely aids clarity — e.g. highlighting a key word or
  listing a few options — but stay conversational: no headings, no code blocks
  unless the topic calls for it.
- Write your reply as flowing paragraphs, not one sentence per line. Only start a
  new paragraph when the topic genuinely shifts.`;
}

function learnerContextPrompt(ctx: ConversationContext): string {
  return `=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}`;
}

function dynamicDataPrompt(ctx: ConversationContext): string {
  // When evidence is sufficient, include a dynamic reading as an extra calibration section; otherwise rely on the static level alone.
  const calibrationBlock = ctx.calibrationHint
    ? `=== CURRENT READ ON THIS LEARNER (recent activity) ===\n${ctx.calibrationHint} Let this fine-tune your difficulty and reply length.\n\n`
    : "";
  // Session-level adjustments (from branches) take priority over default behavior; omit the entire block when there are no adjustments.
  const adjustmentsBlock = ctx.sessionAdjustments
    ? `\n\n=== SESSION ADJUSTMENTS (apply on top of everything above) ===\n${ctx.sessionAdjustments}`
    : "";
  // STORY SO FAR = rolling summary of earlier content (auto-compressed). It lives
  // in the system prompt now that the recent turns are real chat messages; omit
  // the block entirely when there is no summary.
  const storyBlock = ctx.summary
    ? `\n\n=== STORY SO FAR (earlier in this conversation) ===\n${ctx.summary}`
    : "";
  const base = `${calibrationBlock}=== COMFORTABLE WITH (safe scaffolds, do not reteach) ===
${formatComfortableItems(ctx.comfortableItems)}

=== DUE FOR REVIEW (weave in at most one, only if it fits) ===
${formatReviewItems(ctx.reviewItems)}${adjustmentsBlock}${storyBlock}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

function systemMessages(ctx: ConversationContext): ChatMessage[] {
  if (ctx.standaloneQuestion)
    return [{ role: "system", content: standaloneSystemPrompt(ctx) }];
  return [
    { role: "system", content: stableRulesPrompt(ctx) },
    { role: "system", content: learnerContextPrompt(ctx) },
    { role: "system", content: dynamicDataPrompt(ctx) },
  ];
}

function standaloneSystemPrompt(ctx: ConversationContext): string {
  const base = `You are a helpful language-learning assistant for a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at roughly ${ctx.level} level.

RULES
- Treat the latest message as a standalone side question. Do not use, infer from, or continue any surrounding chat or lesson context.
- Answer the question directly and self-containedly.
- Use ${ctx.nativeLanguage} for explanations unless the learner asks for another language. Use ${ctx.targetLanguage} examples when they help.
- If the learner asks how to say something in ${ctx.targetLanguage}, give natural options, brief usage notes, and a compact example.
- Do not grade the learner's message, do not create a correction-panel style response, and do not weave in review items.
- Ask a follow-up only when it directly helps answer the standalone question.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

// The latest learner message (or the hidden app kickoff for a derived conversation).
function latestUserMessage(ctx: ConversationContext): string {
  return ctx.openingInstruction?.trim()
    ? `APP INSTRUCTION: ${ctx.openingInstruction.trim()}`
    : ctx.userInput;
}

// Plain-text streaming reply. onDelta pushes to the UI as chunks arrive; returns the full text for persistence.
// onContext (optional) reports the estimated prompt size of the assembled messages — the real context the model
// receives this turn (system prompt + scaffolds + summary + history + input), used to drive the UI usage meter.
export async function converse(
  provider: ModelProvider,
  ctx: ConversationContext,
  onDelta: (delta: string) => void,
  onContext?: (promptTokens: number) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    ...systemMessages(ctx),
    ...(ctx.standaloneQuestion ? [] : buildHistoryMessages(ctx.historyTurns)),
    { role: "user", content: latestUserMessage(ctx) },
  ];
  // Report the local estimate immediately for a responsive meter; refine to the provider's real prompt size
  // (onUsage.inputTokens) when the stream reports it. Endpoints without usage keep the estimate.
  onContext?.(estimatePromptTokens(messages.map((m) => m.content)));
  return provider.stream(
    {
      messages,
      temperature: 0.7,
      meta: { label: "conversation" },
      onUsage: (u) => {
        if (u.inputTokens != null) onContext?.(u.inputTokens);
      },
    },
    onDelta,
  );
}
