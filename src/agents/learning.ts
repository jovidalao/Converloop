import { estimatePromptTokens } from "../lib/tokens";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";
import { buildHistoryMessages, type HistoryTurn } from "./history-messages";

export interface LearningAgentContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  experiencePreferences: string; // experience preferences explicitly configured by the user on the settings page
  agentName: string;
  agentPrompt: string;
  dataContext: string;
  summary: string; // rolling summary: recap of earlier lesson conversation (auto-compressed; empty if none)
  historyTurns: HistoryTurn[]; // verbatim recent lesson turns, sent as real alternating user/assistant messages
  userInput: string;
  kickoff: boolean;
  customInstructions?: string; // additional instructions appended by the user in the agent library (lesson teacher)
}

// The system prompt is split into stable-first system messages so providers can prefix-cache it
// (Anthropic puts a cache breakpoint on every block except the last; see providers/anthropic.ts):
//   1. stable base rules (config-only)
//   2. lesson-stable context — learner preferences + the custom lesson prompt
//   3. per-turn data — learning data scope + rolling summary
function systemMessages(ctx: LearningAgentContext): ChatMessage[] {
  const rules = `You are a dedicated teacher for a customized language-learning session called "${ctx.agentName}".
The learner is a ${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at roughly ${ctx.level} level.

BASE RULES
- This is NOT the normal free conversation mode. You are a teacher leading a focused lesson.
- You may use ${ctx.nativeLanguage} for explanations, planning, summaries, and feedback when it helps. Use ${ctx.targetLanguage} for examples, drills, and learner production.
- Do not assume every learner message is target-language practice; in this mode the learner may ask questions or answer in either language.
- Give correction and coaching directly in the chat. There is no separate correction panel in this mode.
- Follow the learner experience preferences below for language variety, spelling,
  phrasing, tone, and correction strictness.
- Use the learner data below as grounding. Do not claim access to data that is not shown.
- When you drill a point from the learner data, anchor the exercise to one
  specific item or expression from that data. Refer to it by its human label or
  example, not by raw database key.
- Start with the most useful next step, then ask the learner to do something small and concrete.
- Keep the lesson focused and interactive. Avoid long generic lectures.`;
  const lessonContext = `LEARNER EXPERIENCE PREFERENCES
${ctx.experiencePreferences || "(none)"}

CUSTOM LESSON PROMPT
${ctx.agentPrompt}`;
  const data = `=== AVAILABLE LEARNER DATA ===
${ctx.dataContext || "(no learner data available yet)"}${storyBlock(ctx)}`;
  return [
    { role: "system", content: rules },
    { role: "system", content: lessonContext },
    {
      role: "system",
      content: appendUserInstructions(data, ctx.customInstructions),
    },
  ];
}

// STORY SO FAR = rolling summary of earlier lesson content (auto-compressed). It
// lives in the system prompt now that recent turns are real chat messages; omit
// the block entirely when there is no summary.
function storyBlock(ctx: LearningAgentContext): string {
  return ctx.summary
    ? `\n\n=== STORY SO FAR (earlier in this lesson) ===\n${ctx.summary}`
    : "";
}

// The latest learner message (or the hidden kickoff cue that opens a lesson).
function latestUserMessage(ctx: LearningAgentContext): string {
  return ctx.kickoff
    ? "Start this customized lesson now. Proactively summarize the relevant learner data and begin the first exercise."
    : ctx.userInput;
}

export async function runLearningAgent(
  provider: ModelProvider,
  ctx: LearningAgentContext,
  onDelta: (delta: string) => void,
  onContext?: (promptTokens: number) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    ...systemMessages(ctx),
    ...buildHistoryMessages(ctx.historyTurns),
    { role: "user", content: latestUserMessage(ctx) },
  ];
  // Report the local estimate immediately for a responsive meter; refine to the provider's real prompt size
  // (onUsage.inputTokens) when the stream reports it. Endpoints without usage keep the estimate.
  onContext?.(estimatePromptTokens(messages.map((m) => m.content)));
  return provider.stream(
    {
      messages,
      temperature: 0.5,
      meta: { label: "learning_agent" },
      onUsage: (u) => {
        if (u.inputTokens != null) onContext?.(u.inputTokens);
      },
    },
    onDelta,
  );
}
