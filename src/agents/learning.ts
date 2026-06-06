import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";

export interface LearningAgentContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  experiencePreferences: string; // experience preferences explicitly configured by the user on the settings page
  agentName: string;
  agentPrompt: string;
  dataContext: string;
  summary: string; // rolling summary: recap of earlier lesson conversation (auto-compressed; empty if none)
  history: string;
  userInput: string;
  kickoff: boolean;
  customInstructions?: string; // additional instructions appended by the user in the agent library (lesson teacher)
}

function systemPrompt(ctx: LearningAgentContext): string {
  const base = `You are a dedicated teacher for a customized language-learning session called "${ctx.agentName}".
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
- Keep the lesson focused and interactive. Avoid long generic lectures.

LEARNER EXPERIENCE PREFERENCES
${ctx.experiencePreferences || "(none)"}

CUSTOM LESSON PROMPT
${ctx.agentPrompt}

=== AVAILABLE LEARNER DATA ===
${ctx.dataContext || "(no learner data available yet)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

function userPrompt(ctx: LearningAgentContext): string {
  const latest = ctx.kickoff
    ? "Start this customized lesson now. Proactively summarize the relevant learner data and begin the first exercise."
    : ctx.userInput;
  // STORY SO FAR = summary of earlier lesson conversation (auto-compressed), so long lessons don't lose earlier context; omit the whole block if there is no summary.
  const storyBlock = ctx.summary
    ? `=== STORY SO FAR (earlier in this lesson) ===
${ctx.summary}

`
    : "";
  return `${storyBlock}=== RECENT LESSON CONVERSATION ===
${ctx.history || "(none)"}

=== LATEST LEARNER MESSAGE ===
${latest}`;
}

export async function runLearningAgent(
  provider: ModelProvider,
  ctx: LearningAgentContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream(
    { messages, temperature: 0.5, meta: { label: "learning_agent" } },
    onDelta,
  );
}
