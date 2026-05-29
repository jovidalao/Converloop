import type { ChatMessage, ModelProvider } from "../providers/types";
import { TutorAnalysis, tutorJsonSchema } from "./schema";

// SQLite 薄弱表喂给导师的行(由 mastery 查询提供)。
export interface WeakItem {
  label: string;
  key: string;
  type: string;
  status: string;
}

export interface TutorContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  weakList: WeakItem[];
  history: string; // 最近几轮对话,纯文本
  userInput: string;
}

function formatWeakList(items: WeakItem[]): string {
  if (items.length === 0) return "(none yet)";
  return items
    .map((w) => `- [${w.type}] ${w.label} (${w.key}) — status=${w.status}`)
    .join("\n");
}

// 见 docs/tutor-agent.md#system-prompt
function systemPrompt(ctx: TutorContext): string {
  return `You are a precise language tutor analyzing a single message from a
${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at ${ctx.level} level. You give
structured feedback only — a separate conversation agent handles the chat.

FEEDBACK
- Correct only real errors. Do NOT rewrite acceptable stylistic choices. If
  something is grammatical but unnatural, use severity="minor",
  category="naturalness" — don't treat it as an error.
- For each error give the smallest wrong span, its fix, and a short explanation
  IN ${ctx.nativeLanguage}.
- Use a consistent lowercase snake_case mastery_key per recurring problem type
  (e.g. "grammar:article_usage"). Same problem ⇒ same key, every time. Reuse the
  keys already present in the weak list below whenever they apply.
- If the message is fully correct: is_correct=true, issues=[].
- "natural" = a more idiomatic rendering (may equal "corrected").

BOOKKEEPING (mastery_updates)
- Do NOT list the user's errors here — those come from issues.
- Add a "correct" signal when the user correctly used something from their weak
  list, or anything notable they got right.
- Add an "introduced" signal for any new word/structure you introduced.

Return ONLY the structured object defined by the schema.

=== KNOWN WEAK POINTS (reuse these mastery_key values) ===
${formatWeakList(ctx.weakList)}`;
}

function userPrompt(ctx: TutorContext): string {
  return `=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER MESSAGE TO ANALYZE ===
${ctx.userInput}`;
}

// 结构化分析。safeParse 失败或网络失败都降级为 null —— 调用方据此"只保留对话、本轮不更新 mastery"。
export async function analyze(
  provider: ModelProvider,
  ctx: TutorContext,
): Promise<TutorAnalysis | null> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  try {
    const raw = await provider.generate({
      messages,
      temperature: 0,
      jsonSchema: tutorJsonSchema(),
    });
    const parsed = TutorAnalysis.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
