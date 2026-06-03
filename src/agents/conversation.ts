import type { ReviewItem } from "../db/mastery";
import type { ChatMessage, ModelProvider } from "../providers/types";

export interface ConversationContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  profileSlice: string; // MD 档案切片(Task 7 前用占位)
  experiencePreferences: string; // 用户在设置页显式配置的体验偏好
  reviewItems: ReviewItem[]; // 代码选的复习候选,自然复用(见 db/mastery getReviewDueList)
  calibrationHint: string; // 证据驱动的难度校准(见 lib/proficiency;证据不足时为空)
  sessionAdjustments: string; // 会话级调节指令(分支带来的难度/角色/第二天等;无则为空)
  summary: string; // 滚动摘要:较早内容的目标语 recap(自动压缩产出;无则为空)
  history: string;
  userInput: string;
  openingInstruction?: string; // App 触发的隐藏开场指令(对话衍生)
}

// 折叠空白并截到 max 字符,防止过长 example 撑大热路径 prompt(与 learning-data 一致)。
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

// 见 docs/conversation-agent.md#system-prompt
function systemPrompt(ctx: ConversationContext): string {
  // 证据足够时,把动态读数作为额外一行校准提示;不足则只用静态 level。
  const calibrationLine = ctx.calibrationHint
    ? `\n- Current read on this learner from recent activity: ${ctx.calibrationHint} Let this fine-tune your difficulty and reply length.`
    : "";
  // 会话级调节(分支)优先于默认行为;无调节时整段省略。
  const adjustmentsBlock = ctx.sessionAdjustments
    ? `\n\n=== SESSION ADJUSTMENTS (apply on top of everything above) ===\n${ctx.sessionAdjustments}`
    : "";
  return `You are a warm, natural conversation partner for a ${ctx.nativeLanguage} speaker
learning ${ctx.targetLanguage} at roughly ${ctx.level} level. Your only job here is to
keep the conversation flowing — another agent handles correction and feedback.

RULES
- Respond IN ${ctx.targetLanguage}, calibrated to ${ctx.level}: slightly stretch the user,
  never overwhelm them.${calibrationLine}
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
- Below the profile is a short DUE-FOR-REVIEW list the app selected: things the
  learner met before but hasn't practiced lately. Where it fits naturally, weave
  in ONE (at most two) so they meet it again — this is how review happens. Keep it
  subtle, never announce it, and skip it entirely if nothing fits the moment.
- If the profile ends with "My notes", those are notes the user wrote themselves:
  reminders, standing requests, or facts they want you to keep in mind. Treat them
  as the user's own instructions — honor them and weave the facts in naturally,
  just like About me. Never recite them back as a list.
- Pick topics aligned with their interests when you have the freedom to.
- End with a light follow-up question when it helps keep them talking.
- Keep it to a natural chat length. You may use light Markdown (bold, italics,
  bullet lists) when it genuinely aids clarity — e.g. highlighting a key word or
  listing a few options — but stay conversational: no headings, no code blocks
  unless the topic calls for it.${adjustmentsBlock}

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== LEARNER PROFILE ===
${ctx.profileSlice || "(no profile yet)"}

=== DUE FOR REVIEW (weave in at most one, only if it fits) ===
${formatReviewItems(ctx.reviewItems)}`;
}

function userPrompt(ctx: ConversationContext): string {
  // STORY SO FAR = 较早对话的摘要(自动压缩产出),让长对话不丢前文;无摘要则整段省略。
  const storyBlock = ctx.summary
    ? `=== STORY SO FAR (earlier in this conversation) ===
${ctx.summary}

`
    : "";
  const latest = ctx.openingInstruction?.trim()
    ? `APP INSTRUCTION: ${ctx.openingInstruction.trim()}`
    : ctx.userInput;
  return `${storyBlock}=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER ===
${latest}`;
}

// 纯文本流式回复。onDelta 边收边推 UI;返回完整文本用于持久化。
export async function converse(
  provider: ModelProvider,
  ctx: ConversationContext,
  onDelta: (delta: string) => void,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.stream(
    { messages, temperature: 0.7, meta: { label: "conversation" } },
    onDelta,
  );
}
