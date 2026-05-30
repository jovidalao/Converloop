import type { ChatMessage, ModelProvider } from "../providers/types";
import { TutorAnalysis, tutorJsonSchema } from "./schema";
import {
  formatZodError,
  normalizeTutorPayload,
  parseLLMJson,
} from "./parse-llm-json";

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

export interface AnalyzeResult {
  analysis: TutorAnalysis | null;
  error?: string;
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

function parseTutorRaw(raw: string): AnalyzeResult {
  const parsedJson = parseLLMJson(raw);
  if (!parsedJson.ok) {
    return { analysis: null, error: parsedJson.error };
  }

  const normalized = normalizeTutorPayload(parsedJson.value);
  const validated = TutorAnalysis.safeParse(normalized);
  if (validated.success) {
    return { analysis: validated.data };
  }

  return {
    analysis: null,
    error: `JSON 字段校验失败: ${formatZodError(validated.error)}`,
  };
}

async function requestTutorRaw(
  provider: ModelProvider,
  messages: ChatMessage[],
): Promise<string> {
  const schema = tutorJsonSchema();

  try {
    const raw = await provider.generate({
      messages,
      temperature: 0,
      jsonSchema: schema,
    });
    if (raw.trim()) return raw;
    console.warn("json_schema 模式返回空内容,尝试 json_object 回退");
  } catch (e) {
    console.warn("json_schema 模式请求失败,尝试 json_object 回退:", e);
  }

  const fallbackMessages: ChatMessage[] = [
    ...messages,
    {
      role: "system",
      content: `Respond with ONE JSON object only (no markdown). It MUST match this schema:\n${JSON.stringify(schema.schema)}`,
    },
  ];
  return provider.generate({
    messages: fallbackMessages,
    temperature: 0,
    jsonObject: true,
  });
}

// 结构化分析。失败时返回具体原因,便于 UI 展示。
export async function analyze(
  provider: ModelProvider,
  ctx: TutorContext,
): Promise<AnalyzeResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  try {
    const raw = await requestTutorRaw(provider, messages);
    const result = parseTutorRaw(raw);
    if (!result.analysis) {
      console.error("导师解析失败:", result.error, "原始响应:", raw.slice(0, 800));
    }
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("导师请求失败:", e);
    return { analysis: null, error: `API 请求失败: ${msg}` };
  }
}
