import { recordTutorOutcome } from "../lib/tutor-stats";
import type { ChatMessage, ModelProvider } from "../providers/types";
import {
  formatZodError,
  normalizeTutorPayload,
  parseLLMJson,
} from "./parse-llm-json";
import { type Issue, TutorAnalysis, tutorJsonSchema } from "./schema";

// SQLite 薄弱表喂给导师的行(由 mastery 查询提供)。
export interface WeakItem {
  label: string;
  key: string;
  type: string;
  status: string;
  example?: string | null;
  notes?: string | null;
}

export interface MasteryKeyHint {
  label: string;
  key: string;
  type: string;
  status: string;
}

export interface TutorContext {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  experiencePreferences: string; // 用户在设置页显式配置的体验偏好
  ignoreCapitalizationIssues: boolean;
  ignorePunctuationIssues: boolean;
  weakList: WeakItem[];
  keyHints?: MasteryKeyHint[];
  history: string; // 最近几轮对话,纯文本
  userInput: string;
}

export interface AnalyzeResult {
  analysis: TutorAnalysis | null;
  /** 结构化 JSON 失败时,第二套 prompt 的自然语言批改(直接展示,不入 mastery 账)。 */
  proseFeedback?: string;
  /** 开发期诊断:结构化/修复失败原因和 raw preview。 */
  diagnostic?: string;
  error?: string;
}

type TutorParseFailureKind = "empty" | "invalid_json" | "schema";

interface TutorParseFailure {
  kind: TutorParseFailureKind;
  message: string;
}

type TutorParseResult =
  | { analysis: TutorAnalysis; error?: never }
  | { analysis: null; error: TutorParseFailure };

function oneLine(s: string, max?: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return max && clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function formatWeakList(items: WeakItem[]): string {
  if (items.length === 0) return "(none yet)";
  return items
    .map((w) => {
      const details = [
        w.example ? `example="${oneLine(w.example, 120)}"` : null,
        w.notes ? `note="${oneLine(w.notes, 120)}"` : null,
      ].filter(Boolean);
      return `- [${w.type}] ${w.label} (${w.key}) — status=${w.status}${
        details.length ? `; ${details.join("; ")}` : ""
      }`;
    })
    .join("\n");
}

function formatKeyHints(items: MasteryKeyHint[] | undefined): string {
  if (!items || items.length === 0) return "(none yet)";
  return items
    .map((w) => `- [${w.type}/${w.status}] ${w.label} (${w.key})`)
    .join("\n");
}

// 见 docs/tutor-agent.md#system-prompt
function systemPrompt(ctx: TutorContext): string {
  return `You are a precise language tutor analyzing a single message from a
${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at ${ctx.level} level. You give
structured feedback only — a separate conversation agent handles the chat.

The user is supposed to write in ${ctx.targetLanguage}, but sometimes falls back to
${ctx.nativeLanguage} (fully or mixed) because they don't know how to say something.
Handle the two cases differently.

A) ERRORS — the user DID produce ${ctx.targetLanguage} but got it wrong.
- Correct only real errors. Do NOT rewrite acceptable stylistic choices. If
  something is grammatical but unnatural, use severity="minor",
  category="naturalness" — don't treat it as an error.
- Apply the learner experience preferences below. If they say to ignore
  capitalization or punctuation, do NOT create issues or mastery_updates for
  differences that are only capitalization/punctuation. You may normalize those
  details in "corrected" or "natural" when another real issue is present.
- For each error give the smallest wrong span, its fix, and a short explanation
  IN ${ctx.nativeLanguage}.
- Use a consistent lowercase snake_case mastery_key per recurring problem type
  (e.g. "grammar:article_usage"). Same problem ⇒ same key, every time. Reuse the
  keys already present in the weak list below whenever they apply.
- Before inventing a new mastery_key, check the recent mastery key hints below.
  If one is the same underlying problem, use that exact key even if the current
  wording is different.
- If the message is fully correct: is_correct=true, issues=[].
- "natural" = a more idiomatic rendering (may equal "corrected").

B) EXPRESSION GAP — the message is wholly or partly in ${ctx.nativeLanguage}, or the
   user signals they don't know how to say something. Do NOT grammar-correct
   ${ctx.nativeLanguage}; instead TEACH how to build the sentence. Set "expression_gap"
   (leave it null otherwise) with:
   - original: the user's message verbatim (the thing they couldn't say).
   - target_expression: the full idiomatic ${ctx.targetLanguage} sentence they wanted.
   - template: a reusable ${ctx.targetLanguage} pattern with ___ slots when the
     expression can be generalized.
   - explanation: IN ${ctx.nativeLanguage}, the THINKING for building this sentence —
     which sentence patterns/structures to use and why, how the pieces fit.
   - key_items: 1–3 key words/collocations/structures, each with a ${ctx.nativeLanguage}
     gloss and a stable mastery_key (type vocab|collocation|grammar).
   - usage_note (optional): when/how to reuse it, IN ${ctx.nativeLanguage}.
   - mastery_key: a stable key for this situation/intent, prefixed "gap:"
     (e.g. "gap:decline_request_politely"); mastery_label: human-readable in
     ${ctx.nativeLanguage}.
   MIXED input: still fill issues[] for the ${ctx.targetLanguage} part AND expression_gap
   for the ${ctx.nativeLanguage} part. is_correct concerns only the ${ctx.targetLanguage} part.

BOOKKEEPING (mastery_updates)
- Do NOT list the user's errors here (they come from issues) and do NOT list
  expression_gap key_items here (handled separately). Only:
  - "correct": user correctly used something from their weak list / notable.
    This INCLUDES "gap:" items: if the user now produces, in ${ctx.targetLanguage}
    and unaided, an expression matching a "gap:" key in the weak list, emit a
    "correct" update with that exact key and type "expression_gap". That is the
    only way an expression gap graduates out of "struggling".
  - "introduced": a new word/structure YOU introduced in feedback.

Never output counts, scores, or confidence — only discrete observations.

OUTPUT CONTRACT
- Return exactly ONE JSON object. No markdown fences, no prose, no reasoning.
- Always include these top-level keys: is_correct, corrected, natural, issues,
  mastery_updates, expression_gap.
- Use [] for empty arrays. Use expression_gap:null when there is no expression gap.
- Do not include keys outside the schema.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== KNOWN WEAK POINTS (reuse these mastery_key values) ===
${formatWeakList(ctx.weakList)}

=== RECENT MASTERY KEY HINTS (reuse instead of making duplicates) ===
${formatKeyHints(ctx.keyHints)}`;
}

function userPrompt(ctx: TutorContext): string {
  return `=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER MESSAGE TO ANALYZE ===
${ctx.userInput}`;
}

// 第二套:不依赖 JSON schema,固定版式纯文本,供 UI 直接渲染。
function proseSystemPrompt(ctx: TutorContext): string {
  return `You are a precise language tutor. A separate agent handles chat;
you only analyze the user's latest message in ${ctx.targetLanguage}.

Reply in ${ctx.nativeLanguage} using EXACTLY this plain-text template (no JSON, no markdown code fences, no reasoning):

【总评】正确
或
【总评】有误

【改正句】<full corrected sentence, or repeat the user sentence if fully correct>
【更地道】<more idiomatic version, or "同改正句" if same>

【问题列表】
- （轻微|中等|严重）<类别>：<原片段> → <改正>；<简短说明>
(If no errors, write one line: - 无)

Rules:
- Only flag real errors; stylistic preference → 轻微 + 自然度.
- Apply these learner experience preferences:
${ctx.experiencePreferences || "(none)"}
- Do not invent JSON or schema fields.
- Output only the filled template, nothing else.

=== KNOWN WEAK POINTS ===
${formatWeakList(ctx.weakList)}

=== RECENT MASTERY KEY HINTS ===
${formatKeyHints(ctx.keyHints)}`;
}

function normalizeIgnoredText(
  text: string,
  ctx: Pick<
    TutorContext,
    "ignoreCapitalizationIssues" | "ignorePunctuationIssues"
  >,
): string {
  let normalized = text.normalize("NFKC");
  if (ctx.ignorePunctuationIssues) {
    normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, "");
  }
  if (ctx.ignoreCapitalizationIssues) {
    normalized = normalized.toLocaleLowerCase();
  }
  return normalized.replace(/\s+/g, " ").trim();
}

function shouldIgnoreIssue(
  issue: Issue,
  ctx: Pick<
    TutorContext,
    "ignoreCapitalizationIssues" | "ignorePunctuationIssues"
  >,
): boolean {
  if (ctx.ignorePunctuationIssues && issue.category === "punctuation") {
    return true;
  }
  if (!ctx.ignoreCapitalizationIssues && !ctx.ignorePunctuationIssues) {
    return false;
  }
  return (
    normalizeIgnoredText(issue.span_original, ctx) ===
    normalizeIgnoredText(issue.span_corrected, ctx)
  );
}

function applyCorrectionPreferences(
  analysis: TutorAnalysis,
  ctx: Pick<
    TutorContext,
    "ignoreCapitalizationIssues" | "ignorePunctuationIssues"
  >,
): TutorAnalysis {
  const issues = analysis.issues.filter(
    (issue) => !shouldIgnoreIssue(issue, ctx),
  );
  if (issues.length === analysis.issues.length) return analysis;
  return {
    ...analysis,
    is_correct: issues.length === 0 ? true : analysis.is_correct,
    issues,
  };
}

function parseTutorRaw(raw: string, ctx: TutorContext): TutorParseResult {
  const parsedJson = parseLLMJson(raw);
  if (!parsedJson.ok) {
    return {
      analysis: null,
      error: { kind: parsedJson.kind, message: parsedJson.error },
    };
  }

  const normalized = normalizeTutorPayload(parsedJson.value);
  const validated = TutorAnalysis.safeParse(normalized);
  if (validated.success) {
    return { analysis: applyCorrectionPreferences(validated.data, ctx) };
  }

  return {
    analysis: null,
    error: {
      kind: "schema",
      message: `JSON 字段校验失败: ${formatZodError(validated.error)}`,
    },
  };
}

const TUTOR_MAX_OUTPUT_TOKENS = 4096;

function fallbackMessages(
  messages: ChatMessage[],
  schema: ReturnType<typeof tutorJsonSchema>,
): ChatMessage[] {
  const reminder = `Respond with ONE JSON object only (no markdown, no reasoning). It MUST match this schema:\n${JSON.stringify(schema.schema)}`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem === -1)
    return [{ role: "system", content: reminder }, ...messages];
  return messages.map((m, index) =>
    index === firstSystem
      ? { ...m, content: `${m.content}\n\n${reminder}` }
      : m,
  );
}

async function requestStructuredTutorRaw(
  provider: ModelProvider,
  messages: ChatMessage[],
): Promise<string> {
  const schema = tutorJsonSchema();
  const base = {
    messages,
    temperature: 0,
    maxTokens: TUTOR_MAX_OUTPUT_TOKENS,
    meta: { label: "tutor" },
  } as const;

  try {
    const raw = await provider.generate({ ...base, jsonSchema: schema });
    if (raw.trim()) return raw;
    console.warn("json_schema 模式返回空内容,尝试 json_object 回退");
  } catch (e) {
    console.warn("json_schema 模式请求失败,尝试 json_object 回退:", e);
  }

  return provider.generate({
    messages: fallbackMessages(messages, schema),
    temperature: 0,
    maxTokens: TUTOR_MAX_OUTPUT_TOKENS,
    jsonObject: true,
    meta: { label: "tutor_json_object" },
  });
}

async function requestRepairedTutorRaw(
  provider: ModelProvider,
  ctx: TutorContext,
  badOutput: string,
  parseError: string,
): Promise<string> {
  const schema = tutorJsonSchema();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You repair a failed TutorAnalysis response for a language-learning app.

Return exactly ONE valid JSON object only. No markdown, no prose, no reasoning.
It MUST match this schema:
${JSON.stringify(schema.schema)}

If the previous output is unusable, re-analyze the source message directly.
For normal ${ctx.targetLanguage} input, set expression_gap:null.
Use [] for empty issues and mastery_updates.`,
    },
    {
      role: "user",
      content: `=== PARSE ERROR ===
${parseError}

=== PREVIOUS INVALID OUTPUT ===
${badOutput.slice(0, 6000)}

=== KNOWN WEAK POINTS ===
${formatWeakList(ctx.weakList)}

=== RECENT MASTERY KEY HINTS ===
${formatKeyHints(ctx.keyHints)}

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}

=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER MESSAGE TO ANALYZE ===
${ctx.userInput}`,
    },
  ];
  return provider.generate({
    messages,
    temperature: 0,
    maxTokens: TUTOR_MAX_OUTPUT_TOKENS,
    jsonSchema: schema,
    meta: { label: "tutor_repair" },
  });
}

async function requestProseFeedback(
  provider: ModelProvider,
  ctx: TutorContext,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: proseSystemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return provider.generate({
    messages,
    temperature: 0.2,
    maxTokens: TUTOR_MAX_OUTPUT_TOKENS,
  });
}

function stripModelFences(text: string): string {
  const t = text.trim();
  const fenced = t.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1].trim() : t;
}

function parseFailureText(error: TutorParseFailure): string {
  return `${error.kind}: ${error.message}`;
}

function rawPreview(raw: string, max = 1200): string {
  const clean = raw.trim();
  if (!clean) return "(empty)";
  return clean.length > max ? `${clean.slice(0, max)}\n…[truncated]` : clean;
}

function formatTutorDiagnostic(
  attempts: { label: string; failure: string; raw?: string }[],
): string {
  const lines = ["结构化批改已降级为纯文本;本轮未写入 mastery。", "开发诊断:"];
  for (const [i, attempt] of attempts.entries()) {
    lines.push(`${i + 1}. ${attempt.label}: ${attempt.failure}`);
    if (attempt.raw !== undefined) {
      lines.push("raw preview:");
      lines.push(rawPreview(attempt.raw));
    }
  }
  return lines.join("\n");
}

// 结构化分析;JSON 失败时自动走第二套纯文本 prompt 并直接展示,不向用户暴露解析错误。
export async function analyze(
  provider: ModelProvider,
  ctx: TutorContext,
): Promise<AnalyzeResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  try {
    const diagnosticAttempts: {
      label: string;
      failure: string;
      raw?: string;
    }[] = [];
    const raw = await requestStructuredTutorRaw(provider, messages);
    const structured = parseTutorRaw(raw, ctx);
    if (structured.analysis) {
      recordTutorOutcome("structured");
      return structured;
    }
    diagnosticAttempts.push({
      label: "initial json_schema",
      failure: parseFailureText(structured.error),
      raw,
    });

    console.warn(
      "导师结构化解析失败,启用纯文本第二套:",
      parseFailureText(structured.error),
      "原始:",
      raw.slice(0, 400),
    );

    try {
      const repairedRaw = await requestRepairedTutorRaw(
        provider,
        ctx,
        raw,
        parseFailureText(structured.error),
      );
      const repaired = parseTutorRaw(repairedRaw, ctx);
      if (repaired.analysis) {
        recordTutorOutcome("structured");
        return repaired;
      }
      diagnosticAttempts.push({
        label: "repair json_schema",
        failure: parseFailureText(repaired.error),
        raw: repairedRaw,
      });
      console.warn(
        "导师 JSON 修复仍失败,启用纯文本第二套:",
        parseFailureText(repaired.error),
        "原始:",
        repairedRaw.slice(0, 400),
      );
    } catch (e) {
      diagnosticAttempts.push({
        label: "repair json_schema",
        failure: `request_failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      console.warn("导师 JSON 修复请求失败,启用纯文本第二套:", e);
    }

    const proseRaw = await requestProseFeedback(provider, ctx);
    const proseFeedback = stripModelFences(proseRaw);
    if (proseFeedback.trim()) {
      recordTutorOutcome("prose"); // 展示了批改,但本轮不入 mastery 账
      const diagnostic = formatTutorDiagnostic(diagnosticAttempts);
      return { analysis: null, proseFeedback, diagnostic, error: diagnostic };
    }

    recordTutorOutcome("failed");
    const diagnostic = formatTutorDiagnostic([
      ...diagnosticAttempts,
      {
        label: "prose fallback",
        failure: "empty_output",
        raw: proseRaw,
      },
    ]);
    return {
      analysis: null,
      diagnostic,
      error: `批改未能生成内容,请重试或检查模型设置。\n${diagnostic}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("导师请求失败:", e);
    recordTutorOutcome("failed");
    return { analysis: null, error: `API 请求失败: ${msg}` };
  }
}
