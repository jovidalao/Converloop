import { recordTutorOutcome } from "../lib/tutor-stats";
import type { ChatMessage, ModelProvider } from "../providers/types";
import { appendUserInstructions } from "./custom-instructions";
import {
  formatZodError,
  normalizeTutorPayload,
  parseLLMJson,
} from "./parse-llm-json";
import { type Issue, TutorAnalysis, tutorJsonSchema } from "./schema";

// Rows from the SQLite weak-items table fed to the tutor (provided by mastery queries).
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
  experiencePreferences: string; // experience preferences explicitly configured by the user on the settings page
  ignoreCapitalizationIssues: boolean;
  ignorePunctuationIssues: boolean;
  weakList: WeakItem[];
  keyHints?: MasteryKeyHint[];
  history: string; // last few conversation turns, plain text
  userInput: string;
  customInstructions?: string; // additional instructions appended by the user in the agent library
  /** Dictation drill: the exact sentence that was spoken. When set, grading is a comparison to this standard answer
   *  (missed/misheard words, spelling) rather than free-form conversation correction. */
  standardAnswer?: string;
}

export interface AnalyzeResult {
  analysis: TutorAnalysis | null;
  /** When structured JSON fails, the natural-language correction from the fallback prompt (shown directly, not recorded in mastery). */
  proseFeedback?: string;
  /** Development diagnostic: reason for structured/repair failure and raw preview. */
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

// Dictation grading: the learner listened to one sentence and typed what they heard. We KNOW the correct sentence
// (the standard answer), so correction is a direct comparison — what they missed or misheard — not a free-form
// conversational correction. Output is the same TutorAnalysis shape so the UI renders identically.
function dictationSystemPrompt(ctx: TutorContext): string {
  const base = `You are a precise dictation grader for a ${ctx.nativeLanguage} speaker
learning ${ctx.targetLanguage} at ${ctx.level} level. The learner just LISTENED to ONE
${ctx.targetLanguage} sentence and TYPED what they heard. You are given the EXACT sentence that was
spoken — the standard answer. Grade their transcription ONLY by comparing it to that standard answer.
Do NOT "improve" the sentence, suggest alternatives, or judge it as a conversational reply — there is
exactly one correct target.

RULES
- "corrected" = the standard answer, verbatim. "natural" = the same standard answer (no alternatives).
- For each place the transcription differs from the standard answer (a missed word, a misheard/wrong
  word, a spelling slip, wrong or missing word order), emit ONE issue:
  - span_original = what the learner typed at that spot (or the surrounding words where something is missing),
  - span_corrected = the standard answer's wording there,
  - category = the closest of spelling | word_choice | grammar | punctuation,
  - severity by how much it changes the meaning,
  - explanation IN ${ctx.nativeLanguage}: what they misheard or missed, plus a quick listening tip.
  - Set mastery_key="dictation:transcription", mastery_label (in ${ctx.nativeLanguage}, e.g. "听写：听漏/听错"),
    mastery_type="error_pattern" for every issue (these are not tracked as production weaknesses).
- Apply the learner experience preferences below: if they opt out of capitalization or punctuation, do NOT
  flag differences that are ONLY capitalization/punctuation.
- If the transcription matches the standard answer (ignoring any opted-out capitalization/punctuation):
  is_correct=true, issues=[].
- ALWAYS set mastery_updates=[] and expression_gap=null.

OUTPUT CONTRACT
- Return exactly ONE JSON object. No markdown fences, no prose, no reasoning.
- Always include: is_correct, corrected, natural, issues, mastery_updates, expression_gap.
- Use [] for empty arrays and expression_gap:null. Do not include keys outside the schema.

=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}`;
  return appendUserInstructions(base, ctx.customInstructions);
}

// See docs/tutor-agent.md#system-prompt
function systemPrompt(ctx: TutorContext): string {
  if (ctx.standardAnswer) return dictationSystemPrompt(ctx);
  const base = `You are a precise language tutor analyzing a single message from a
${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at ${ctx.level} level. You give
structured feedback only — a separate conversation agent handles the chat.

The user is supposed to write in ${ctx.targetLanguage}, but sometimes falls back to
${ctx.nativeLanguage} (fully or mixed) because they don't know how to say something.
Handle the two cases differently.

A) ERRORS — the user DID produce ${ctx.targetLanguage} but got it wrong.
- Correct only real errors. Do NOT rewrite acceptable stylistic choices. If
  something is grammatical but unnatural, use severity="minor",
  category="naturalness" — don't treat it as an error.
- Apply the learner experience preferences below. They may ask you to ignore
  transcription/formatting artifacts — capitalization, spacing, hyphenation, or
  punctuation — which are common with voice/dictation input. For any such
  category they opt out of, do NOT create issues or mastery_updates for
  differences that are ONLY that (e.g. "well known" vs "well-known", a missing or
  extra space, a lowercase sentence start, a missing comma). You may still
  normalize those details in "corrected"/"natural" when another real issue is
  present.
- For each error give the smallest wrong span, its fix, and a short explanation
  IN ${ctx.nativeLanguage}.
- Use a consistent lowercase snake_case mastery_key per recurring problem type
  (e.g. "grammar:article_usage"). Same problem ⇒ same key, every time. Reuse the
  keys already present in the weak list below whenever they apply.
- Before inventing a new mastery_key, check the recent mastery key hints below.
  If one is the same underlying problem, use that exact key even if the current
  wording is different.
- If the message is fully correct: is_correct=true, issues=[].
- "natural" = a more idiomatic rendering of the user's message (may equal
  "corrected"). The user's message is a reply in the conversation above, so read
  the partner's most recent line in RECENT CONVERSATION and make "natural" flow
  as a natural response to it (right register, connectives, and references to
  what the partner just said) — not just a sentence fixed in isolation.

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
  return appendUserInstructions(base, ctx.customInstructions);
}

function userPrompt(ctx: TutorContext): string {
  if (ctx.standardAnswer) {
    return `=== STANDARD ANSWER (the exact sentence that was spoken) ===
${ctx.standardAnswer}

=== LEARNER'S TRANSCRIPTION TO GRADE ===
${ctx.userInput}`;
  }
  return `=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER MESSAGE TO ANALYZE ===
${ctx.userInput}`;
}

// Fallback: does not rely on JSON schema; fixed plain-text format for direct UI rendering.
function proseSystemPrompt(ctx: TutorContext): string {
  const dictationNote = ctx.standardAnswer
    ? `\nThis is a DICTATION drill: the user typed what they heard. The STANDARD ANSWER (the exact sentence
spoken) is given in the user message. Grade their transcription ONLY by comparing it to that standard
answer — 改正句 is the standard answer verbatim, 更地道 is "同改正句", and 问题列表 lists what they missed or
misheard.\n`
    : "";
  const base = `You are a precise language tutor. A separate agent handles chat;
you only analyze the user's latest message in ${ctx.targetLanguage}.
${dictationNote}
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
  return appendUserInstructions(base, ctx.customInstructions);
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
      message: `JSON field validation failed: ${formatZodError(validated.error)}`,
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
    console.warn(
      "json_schema mode returned empty content, trying json_object fallback",
    );
  } catch (e) {
    console.warn(
      "json_schema mode request failed, trying json_object fallback:",
      e,
    );
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

If the previous output is unusable, re-analyze the source message directly.${
        ctx.standardAnswer
          ? `\nThis is a DICTATION drill: grade the transcription by comparing it to the standard answer below.
corrected = the standard answer verbatim; natural = the same; issues = what was missed or misheard.`
          : `\nFor normal ${ctx.targetLanguage} input, set expression_gap:null.`
      }
Use [] for empty mastery_updates.`,
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

${
  ctx.standardAnswer
    ? `=== STANDARD ANSWER (the exact sentence that was spoken) ===
${ctx.standardAnswer}

=== LEARNER'S TRANSCRIPTION TO GRADE ===
${ctx.userInput}`
    : `=== RECENT CONVERSATION ===
${ctx.history || "(none)"}

=== USER MESSAGE TO ANALYZE ===
${ctx.userInput}`
}`,
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
  const lines = [
    "Structured correction degraded to plain text; mastery not written this turn.",
    "Development diagnostics:",
  ];
  for (const [i, attempt] of attempts.entries()) {
    lines.push(`${i + 1}. ${attempt.label}: ${attempt.failure}`);
    if (attempt.raw !== undefined) {
      lines.push("raw preview:");
      lines.push(rawPreview(attempt.raw));
    }
  }
  return lines.join("\n");
}

// Structured analysis; automatically falls back to the plain-text prompt on JSON failure and displays it directly, without exposing parse errors to the user.
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
      "Tutor structured parse failed, enabling plain-text fallback:",
      parseFailureText(structured.error),
      "raw:",
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
        "Tutor JSON repair still failed, enabling plain-text fallback:",
        parseFailureText(repaired.error),
        "raw:",
        repairedRaw.slice(0, 400),
      );
    } catch (e) {
      diagnosticAttempts.push({
        label: "repair json_schema",
        failure: `request_failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      console.warn(
        "Tutor JSON repair request failed, enabling plain-text fallback:",
        e,
      );
    }

    const proseRaw = await requestProseFeedback(provider, ctx);
    const proseFeedback = stripModelFences(proseRaw);
    if (proseFeedback.trim()) {
      recordTutorOutcome("prose"); // correction shown, but not recorded in mastery this turn
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
      error: `Correction failed to generate content, please retry or check model settings.\n${diagnostic}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Tutor request failed:", e);
    recordTutorOutcome("failed");
    return { analysis: null, error: `API request failed: ${msg}` };
  }
}
