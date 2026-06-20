import { normalizeKey } from "../db/mastery-logic";
import { logDebug, logError } from "../lib/log";
import { recordTutorOutcome } from "../lib/tutor-stats";
import type {
  ChatMessage,
  FinishReason,
  GenerateOptions,
  ModelProvider,
} from "../providers/types";
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
  previousPartnerReply?: string; // the AI line the user's latest message is responding to, when available
  userInput: string;
  customInstructions?: string; // additional instructions appended by the user in the agent library
  /** Dictation drill: the exact target sentence. When set, grading is a comparison to this standard answer
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
// Each missed/misheard word gets its own "listening:<word>" mastery key: an isolated listening dimension that never
// mixes with production keys (code excludes the prefix from production queries) but lets the next dictation session
// weave the words back in for re-exposure.
function dictationRulesPrompt(ctx: TutorContext): string {
  return `You are a precise dictation grader for a ${ctx.nativeLanguage} speaker
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
  - mastery_key = "listening:" + the single most content-bearing ${ctx.targetLanguage} word they missed or
    misheard at that spot, lowercased (e.g. "listening:receipt"). mastery_label = that word verbatim;
    mastery_type="vocab". These keys live in an isolated listening dimension — never reuse production
    keys from any weak list for them.
- Apply the learner experience preferences below: if they opt out of capitalization or punctuation, do NOT
  flag differences that are ONLY capitalization/punctuation.
- If the transcription matches the standard answer (ignoring any opted-out capitalization/punctuation):
  is_correct=true, issues=[].
- ALWAYS set mastery_updates=[], expression_gap=null, and highlight=null.

OUTPUT CONTRACT
- Return exactly ONE JSON object. No markdown fences, no prose, no reasoning.
- Always include: is_correct, corrected, natural, issues, mastery_updates, expression_gap.
- Use [] for empty arrays and expression_gap:null. Do not include keys outside the schema.`;
}

// includeGap toggles the expression-gap (native/mixed input) half of the prompt;
// omit it for pure target-language turns so it matches the shallow core schema.
function tutorRulesPrompt(ctx: TutorContext, includeGap: boolean): string {
  return `You are a precise language tutor analyzing a single message from a
${ctx.nativeLanguage} speaker learning ${ctx.targetLanguage} at ${ctx.level} level. You give
structured feedback only — a separate conversation agent handles the chat.
${
  includeGap
    ? `
The user is supposed to write in ${ctx.targetLanguage}, but sometimes falls back to
${ctx.nativeLanguage} (fully or mixed) because they don't know how to say something.
Handle the two cases differently.

A) ERRORS — the user DID produce ${ctx.targetLanguage} but got it wrong.`
    : `
ERRORS — the user produced ${ctx.targetLanguage}; correct only real errors.`
}
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
- If "corrected" changes the user's original message beyond ignored
  formatting/transcription artifacts, issues[] MUST contain at least one issue
  explaining the substantive change. Never set is_correct=false with issues=[]${
    includeGap
      ? `
  unless expression_gap explains the missing native/mixed-language part.`
      : "."
  }
- Use a consistent lowercase snake_case mastery_key per recurring problem type
  (e.g. "grammar:article_usage"). Same problem ⇒ same key, every time. Reuse the
  keys already present in the weak list below whenever they apply.
- Before inventing a new mastery_key, check the recent mastery key hints below.
  If one is the same underlying problem, use that exact key even if the current
  wording is different.
- If the message is fully correct: is_correct=true, issues=[].
- "natural" = a more idiomatic rendering of the user's message (may equal
  "corrected"). Generate it with the same context policy as the input-box reply
  hint: use PARTNER'S LATEST MESSAGE to infer what the learner is trying to
  answer, then make "natural" flow as a natural response to that specific AI
  line (right register, connectives, and references to what the partner just
  said) — not just a sentence fixed in isolation. When a more idiomatic or
  context-fitting alternative exists, make "natural" a distinct alternative;
  copy "corrected" only when it is already the most natural phrasing.${
    includeGap
      ? `

B) EXPRESSION GAP — the message is wholly or partly in ${ctx.nativeLanguage}, or the
   user explicitly signals they don't know how to say something. Do NOT use
   expression_gap for a message that is already composed in ${ctx.targetLanguage}
   but is awkward, unclear, or grammatically wrong; handle that under ERRORS.
   Do NOT grammar-correct
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
   for the ${ctx.nativeLanguage} part. is_correct concerns only the ${ctx.targetLanguage} part.`
      : ""
  }

HIGHLIGHT (positive feedback)
- "highlight": ONLY when the message is fully correct (is_correct=true, no
  issues, no expression gap) AND the user produced something genuinely notable —
  an idiomatic collocation, a weak-list / key-hint item used correctly and
  unaided, natural register for the moment — set ONE short sentence IN
  ${ctx.nativeLanguage} that quotes the exact ${ctx.targetLanguage} span and says
  why it works. Specific praise builds momentum; generic praise erodes trust.
- If nothing stands out, or the message has any issue, set highlight to null.
  An ordinary correct sentence gets null, not a compliment.

BOOKKEEPING (mastery_updates)
- Do NOT list the user's errors here (they come from issues) and do NOT list
  expression_gap key_items here (handled separately). Look ONLY at the latest
  user message, not previous turns or the partner's reply. Only:
  - "correct": the user correctly used something ALREADY TRACKED — reuse the
    exact key from the weak list or the recent mastery key hints below. Do NOT
    invent new keys for things they simply got right; untracked correct usage
    is not an observation.
    This INCLUDES "gap:" items: if the user now produces, in ${ctx.targetLanguage}
    and unaided, an expression matching a "gap:" key in the weak list, emit a
    "correct" update with that exact key and type "expression_gap". That is the
    only way an expression gap graduates out of "struggling".
  - "introduced": a new word/structure YOU introduced in feedback.

Never output counts, scores, or confidence — only discrete observations.

OUTPUT CONTRACT
- Return exactly ONE JSON object. No markdown fences, no prose, no reasoning.
- Always include these top-level keys: is_correct, corrected, natural, issues,
  mastery_updates, highlight${includeGap ? ", expression_gap" : ""}.
- Use [] for empty arrays and highlight:null when nothing stands out.${includeGap ? " Use expression_gap:null when there is no expression gap." : ""}
- Do not include keys outside the schema.`;
}

// The system prompt is split into stable-first system messages so providers can prefix-cache it
// (Anthropic puts a cache breakpoint on every block except the last; see providers/anthropic.ts):
//   1. stable grading rules (config-only; two variants, with/without the expression-gap half)
//   2. slow-changing learner preferences (change when the profile is edited/maintained)
//   3. per-turn weak list + key hints (re-ranked against each input)
function systemMessages(ctx: TutorContext, includeGap: boolean): ChatMessage[] {
  const preferencesBlock = `=== LEARNER EXPERIENCE PREFERENCES ===
${ctx.experiencePreferences || "(none)"}`;
  if (ctx.standardAnswer) {
    return [
      {
        role: "system",
        content: dictationRulesPrompt(ctx),
      },
      {
        role: "system",
        content: appendUserInstructions(
          preferencesBlock,
          ctx.customInstructions,
        ),
      },
    ];
  }
  const dataBlock = `=== KNOWN WEAK POINTS (reuse these mastery_key values) ===
${formatWeakList(ctx.weakList)}

=== RECENT MASTERY KEY HINTS (reuse instead of making duplicates) ===
${formatKeyHints(ctx.keyHints)}`;
  return [
    { role: "system", content: tutorRulesPrompt(ctx, includeGap) },
    { role: "system", content: preferencesBlock },
    {
      role: "system",
      content: appendUserInstructions(dataBlock, ctx.customInstructions),
    },
  ];
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

=== PARTNER'S LATEST MESSAGE (context for "natural") ===
${ctx.previousPartnerReply?.trim() || "(none)"}

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

type ScriptName = "latin" | "han" | "kana" | "hangul" | "cyrillic";

const SCRIPT_PATTERNS: Record<ScriptName, string> = {
  latin: "\\p{Script=Latin}",
  han: "\\p{Script=Han}",
  kana: "[\\p{Script=Hiragana}\\p{Script=Katakana}]",
  hangul: "\\p{Script=Hangul}",
  cyrillic: "\\p{Script=Cyrillic}",
};

function scriptsForLanguage(language: string): ScriptName[] | null {
  const l = language.toLocaleLowerCase();
  if (/(chinese|mandarin|中文|汉语|漢語)/i.test(l)) return ["han"];
  if (/(japanese|日本|日语|日語)/i.test(l)) return ["kana", "han"];
  if (/(korean|한국|韩语|韓語|朝鲜语)/i.test(l)) return ["hangul"];
  if (/(russian|русский|俄语|俄語)/i.test(l)) return ["cyrillic"];
  if (
    /(english|spanish|french|german|portuguese|italian|英语|英語|西班牙|法语|法語|德语|德語|葡萄牙|意大利)/i.test(
      l,
    )
  )
    return ["latin"];
  return null;
}

function scriptsOverlap(a: ScriptName[], b: ScriptName[]): boolean {
  return a.some((script) => b.includes(script));
}

function countScripts(text: string, scripts: ScriptName[]): number {
  return scripts.reduce((sum, script) => {
    const re = new RegExp(SCRIPT_PATTERNS[script], "gu");
    return sum + (text.match(re)?.length ?? 0);
  }, 0);
}

function hasExplicitGapCue(text: string): boolean {
  return /(\bhow (do|can|would) i say\b|\bhow to (say|express)\b|\bwhat'?s the word for\b|\bi don'?t know how to say\b|怎么说|如何表达|不会说|不知道.*说|用.+怎么说)/iu.test(
    text,
  );
}

function likelyContainsNativeFallback(ctx: TutorContext): boolean {
  if (hasExplicitGapCue(ctx.userInput)) return true;
  const nativeScripts = scriptsForLanguage(ctx.nativeLanguage);
  const targetScripts = scriptsForLanguage(ctx.targetLanguage);
  if (!nativeScripts || !targetScripts) return true;
  if (scriptsOverlap(nativeScripts, targetScripts)) return true;
  return countScripts(ctx.userInput, nativeScripts) > 0;
}

function textDiffersAfterPreferences(
  a: string | undefined,
  b: string | undefined,
  ctx: Pick<
    TutorContext,
    "ignoreCapitalizationIssues" | "ignorePunctuationIssues"
  >,
): boolean {
  const left = normalizeIgnoredText(a ?? "", ctx);
  const right = normalizeIgnoredText(b ?? "", ctx);
  return !!left && !!right && left !== right;
}

function sanitizeExpressionGap(
  analysis: TutorAnalysis,
  ctx: TutorContext,
): TutorAnalysis {
  const gap = analysis.expression_gap;
  if (!gap || likelyContainsNativeFallback(ctx)) return analysis;

  const target = gap.target_expression?.trim();
  const user = ctx.userInput.trim();
  const corrected = analysis.corrected?.trim();
  const natural = analysis.natural?.trim();
  const correctedLooksOriginal =
    !corrected || !textDiffersAfterPreferences(corrected, user, ctx);
  const naturalLooksOriginal =
    !natural || !textDiffersAfterPreferences(natural, user, ctx);
  const nextCorrected =
    correctedLooksOriginal && target ? target : analysis.corrected;
  const nextNatural =
    naturalLooksOriginal && target ? target : analysis.natural;
  const hasCorrection =
    analysis.issues.length > 0 ||
    textDiffersAfterPreferences(nextCorrected, user, ctx);

  logDebug(
    "tutor",
    "Tutor emitted expression_gap for a message without native-language script; treating it as target-language correction",
  );
  return {
    ...analysis,
    is_correct: hasCorrection ? false : analysis.is_correct,
    corrected: nextCorrected,
    natural: nextNatural,
    expression_gap: null,
  };
}

function contractViolation(
  analysis: TutorAnalysis,
  ctx: TutorContext,
): string | null {
  if (analysis.expression_gap) return null;
  if (
    !analysis.is_correct &&
    analysis.issues.length === 0 &&
    textDiffersAfterPreferences(analysis.corrected, ctx.userInput, ctx)
  ) {
    return "corrected differs from the user input, but issues[] is empty";
  }
  return null;
}

function neutralizeUnsafeMasteryUpdates(
  analysis: TutorAnalysis,
  ctx: TutorContext,
): TutorAnalysis {
  return contractViolation(analysis, ctx)
    ? { ...analysis, mastery_updates: [] }
    : analysis;
}

// "correct" is evidence for items the system already tracks. The model occasionally invents
// new keys to praise something the user simply got right; those would seed noise items that
// drift to "known" without ever being a real weakness. Code-side backstop for the prompt rule:
// keep only correct updates whose key appears in the weak list / key hints shown to the model.
// "introduced" may still create new keys — surfacing new material is its purpose.
function dropUntrackedCorrects(
  analysis: TutorAnalysis,
  ctx: TutorContext,
): TutorAnalysis {
  const tracked = new Set([
    ...ctx.weakList.map((w) => normalizeKey(w.key)),
    ...(ctx.keyHints ?? []).map((h) => normalizeKey(h.key)),
  ]);
  const updates = analysis.mastery_updates.filter(
    (u) => u.signal !== "correct" || tracked.has(normalizeKey(u.key)),
  );
  if (updates.length === analysis.mastery_updates.length) return analysis;
  return { ...analysis, mastery_updates: updates };
}

// Backstop for the prompt rule: praise belongs only on a fully correct turn (no
// issues, no gap) and on conversation turns, never on drills (those grade against
// a fixed standard answer). A stray highlight elsewhere is dropped, not shown.
function dropMisplacedHighlight(
  analysis: TutorAnalysis,
  ctx: TutorContext,
): TutorAnalysis {
  if (!analysis.highlight?.trim()) return analysis;
  const misplaced =
    !analysis.is_correct ||
    analysis.issues.length > 0 ||
    !!analysis.expression_gap ||
    !!ctx.standardAnswer;
  return misplaced ? { ...analysis, highlight: null } : analysis;
}

function finalizeTutorAnalysis(
  analysis: TutorAnalysis,
  ctx: TutorContext,
): TutorAnalysis {
  return dropMisplacedHighlight(
    dropUntrackedCorrects(sanitizeExpressionGap(analysis, ctx), ctx),
    ctx,
  );
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
    return {
      analysis: finalizeTutorAnalysis(
        applyCorrectionPreferences(validated.data, ctx),
        ctx,
      ),
    };
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
// Reasoning models can spend the whole budget thinking before emitting any answer (finish_reason length +
// empty text). Retry once with a larger cap so the JSON still fits after the reasoning.
const TUTOR_RETRY_MAX_OUTPUT_TOKENS = 8192;

interface TutorRawResult {
  raw: string;
  /** Provider finish reason for the (final) attempt; surfaced in diagnostics. */
  finish?: FinishReason;
}

// Single generate call that captures the provider finish reason and, when the model truncated on reasoning
// (finish_reason length) without producing text, retries once with a larger token budget.
async function generateTutorRaw(
  provider: ModelProvider,
  opts: Omit<GenerateOptions, "onFinish" | "maxTokens">,
): Promise<TutorRawResult> {
  let finish: FinishReason | undefined;
  const run = (maxTokens: number) => {
    finish = undefined;
    return provider.generate({
      ...opts,
      maxTokens,
      onFinish: (reason) => {
        finish = reason;
      },
    });
  };
  let raw = await run(TUTOR_MAX_OUTPUT_TOKENS);
  if (!raw.trim() && finish?.kind === "length") {
    logDebug(
      "tutor",
      "Tutor output truncated on reasoning (finish_reason length) with empty text; retrying with a larger token budget",
    );
    raw = await run(TUTOR_RETRY_MAX_OUTPUT_TOKENS);
  }
  return { raw, finish };
}

function fallbackMessages(
  messages: ChatMessage[],
  schema: ReturnType<typeof tutorJsonSchema>,
): ChatMessage[] {
  const reminder = `Respond with ONE JSON object only (no markdown, no reasoning). It MUST match this schema:\n${JSON.stringify(schema.schema)}`;
  // Append to the LAST system message: the earlier system blocks are the stable cached prefix
  // (see systemMessages), and the reminder belongs with the per-request tail anyway.
  let lastSystem = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "system") {
      lastSystem = i;
      break;
    }
  }
  if (lastSystem === -1)
    return [{ role: "system", content: reminder }, ...messages];
  return messages.map((m, index) =>
    index === lastSystem ? { ...m, content: `${m.content}\n\n${reminder}` } : m,
  );
}

async function requestStructuredTutorRaw(
  provider: ModelProvider,
  messages: ChatMessage[],
  includeGap: boolean,
): Promise<TutorRawResult> {
  const schema = tutorJsonSchema(includeGap);

  // Tier 1: native json_schema structured output.
  try {
    const result = await generateTutorRaw(provider, {
      messages,
      temperature: 0,
      jsonSchema: schema,
      meta: { label: "tutor" },
    });
    if (result.raw.trim()) return result;
    logDebug(
      "tutor",
      "json_schema mode returned empty content, trying json_object fallback",
    );
  } catch (e) {
    logDebug(
      "tutor",
      `json_schema mode request failed, trying json_object fallback: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Tier 2: json_object mode with the schema carried in the prompt (endpoints without json_schema support).
  try {
    const result = await generateTutorRaw(provider, {
      messages: fallbackMessages(messages, schema),
      temperature: 0,
      jsonObject: true,
      meta: { label: "tutor_json_object" },
    });
    if (result.raw.trim()) return result;
    logDebug(
      "tutor",
      "json_object mode returned empty content, trying plain-text JSON fallback",
    );
  } catch (e) {
    logDebug(
      "tutor",
      `json_object mode request failed, trying plain-text JSON fallback: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Tier 3: plain text, no response_format. Some endpoints (reasoning models, lax OpenAI-compatible proxies)
  // emit empty content whenever response_format is set but answer correctly in plain text — recover the JSON here.
  return generateTutorRaw(provider, {
    messages: fallbackMessages(messages, schema),
    temperature: 0,
    meta: { label: "tutor_plaintext" },
  });
}

async function requestRepairedTutorRaw(
  provider: ModelProvider,
  ctx: TutorContext,
  badOutput: string,
  parseError: string,
  includeGap: boolean,
): Promise<TutorRawResult> {
  const schema = tutorJsonSchema(includeGap);
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
          : includeGap
            ? `\nFor normal ${ctx.targetLanguage} input, set expression_gap:null.`
            : ""
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

=== PARTNER'S LATEST MESSAGE (context for "natural") ===
${ctx.previousPartnerReply?.trim() || "(none)"}

=== USER MESSAGE TO ANALYZE ===
${ctx.userInput}`
}`,
    },
  ];
  return generateTutorRaw(provider, {
    messages,
    temperature: 0,
    jsonSchema: schema,
    meta: { label: "tutor_repair" },
  });
}

async function requestProseFeedback(
  provider: ModelProvider,
  ctx: TutorContext,
): Promise<TutorRawResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: proseSystemPrompt(ctx) },
    { role: "user", content: userPrompt(ctx) },
  ];
  return generateTutorRaw(provider, {
    messages,
    temperature: 0.2,
    meta: { label: "tutor_prose" },
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
  attempts: {
    label: string;
    failure: string;
    raw?: string;
    finish?: string;
  }[],
): string {
  const lines = [
    "Structured correction degraded to plain text; mastery not written this turn.",
    "Development diagnostics:",
  ];
  for (const [i, attempt] of attempts.entries()) {
    lines.push(`${i + 1}. ${attempt.label}: ${attempt.failure}`);
    if (attempt.finish) lines.push(`finish reason: ${attempt.finish}`);
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
  // Pure target-language turns can never carry an expression gap, so we send the shallow core
  // schema/prompt; only native, mixed, or dictation turns need the full nested schema. Mirrors
  // sanitizeExpressionGap, which strips any gap the model emits when this is false.
  const includeGap =
    Boolean(ctx.standardAnswer) || likelyContainsNativeFallback(ctx);
  const messages: ChatMessage[] = [
    ...systemMessages(ctx, includeGap),
    { role: "user", content: userPrompt(ctx) },
  ];
  try {
    const diagnosticAttempts: {
      label: string;
      failure: string;
      raw?: string;
      finish?: string;
    }[] = [];
    const structuredResult = await requestStructuredTutorRaw(
      provider,
      messages,
      includeGap,
    );
    const structured = parseTutorRaw(structuredResult.raw, ctx);
    if (structured.analysis) {
      const violation = contractViolation(structured.analysis, ctx);
      if (violation) {
        diagnosticAttempts.push({
          label: "initial json_schema",
          failure: `contract: ${violation}`,
          raw: structuredResult.raw,
          finish: structuredResult.finish?.raw,
        });
        logDebug(
          "tutor",
          `Tutor structured response violated contract, trying JSON repair: ${violation} raw: ${structuredResult.raw.slice(0, 400)}`,
        );
        try {
          const repairedResult = await requestRepairedTutorRaw(
            provider,
            ctx,
            structuredResult.raw,
            `Contract violation: ${violation}. Re-analyze the latest user message and include issues[] for every substantive corrected change.`,
            includeGap,
          );
          const repaired = parseTutorRaw(repairedResult.raw, ctx);
          if (repaired.analysis) {
            const repairViolation = contractViolation(repaired.analysis, ctx);
            if (!repairViolation) {
              recordTutorOutcome("structured");
              return repaired;
            }
            diagnosticAttempts.push({
              label: "repair json_schema",
              failure: `contract: ${repairViolation}`,
              raw: repairedResult.raw,
              finish: repairedResult.finish?.raw,
            });
            logDebug(
              "tutor",
              `Tutor JSON repair still violated contract; returning correction without mastery updates: ${repairViolation}`,
            );
            recordTutorOutcome("structured");
            return {
              analysis: neutralizeUnsafeMasteryUpdates(repaired.analysis, ctx),
              diagnostic: formatTutorDiagnostic(diagnosticAttempts),
            };
          }
          diagnosticAttempts.push({
            label: "repair json_schema",
            failure: parseFailureText(repaired.error),
            raw: repairedResult.raw,
            finish: repairedResult.finish?.raw,
          });
        } catch (e) {
          diagnosticAttempts.push({
            label: "repair json_schema",
            failure: `request_failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          });
          logDebug(
            "tutor",
            `Tutor JSON repair request failed after contract violation; returning correction without mastery updates: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        recordTutorOutcome("structured");
        return {
          analysis: neutralizeUnsafeMasteryUpdates(structured.analysis, ctx),
          diagnostic: formatTutorDiagnostic(diagnosticAttempts),
        };
      }
      recordTutorOutcome("structured");
      return structured;
    }
    diagnosticAttempts.push({
      label: "initial json_schema",
      failure: parseFailureText(structured.error),
      raw: structuredResult.raw,
      finish: structuredResult.finish?.raw,
    });

    logDebug(
      "tutor",
      `Tutor structured parse failed, enabling plain-text fallback: ${parseFailureText(structured.error)} raw: ${structuredResult.raw.slice(0, 400)}`,
    );

    try {
      const repairedResult = await requestRepairedTutorRaw(
        provider,
        ctx,
        structuredResult.raw,
        parseFailureText(structured.error),
        includeGap,
      );
      const repaired = parseTutorRaw(repairedResult.raw, ctx);
      if (repaired.analysis) {
        const repairViolation = contractViolation(repaired.analysis, ctx);
        if (repairViolation) {
          diagnosticAttempts.push({
            label: "repair json_schema",
            failure: `contract: ${repairViolation}`,
            raw: repairedResult.raw,
            finish: repairedResult.finish?.raw,
          });
          logDebug(
            "tutor",
            `Tutor JSON repair violated contract; returning correction without mastery updates: ${repairViolation}`,
          );
          recordTutorOutcome("structured");
          return {
            analysis: neutralizeUnsafeMasteryUpdates(repaired.analysis, ctx),
            diagnostic: formatTutorDiagnostic(diagnosticAttempts),
          };
        }
        recordTutorOutcome("structured");
        return repaired;
      }
      diagnosticAttempts.push({
        label: "repair json_schema",
        failure: parseFailureText(repaired.error),
        raw: repairedResult.raw,
        finish: repairedResult.finish?.raw,
      });
      logDebug(
        "tutor",
        `Tutor JSON repair still failed, enabling plain-text fallback: ${parseFailureText(repaired.error)} raw: ${repairedResult.raw.slice(0, 400)}`,
      );
    } catch (e) {
      diagnosticAttempts.push({
        label: "repair json_schema",
        failure: `request_failed: ${e instanceof Error ? e.message : String(e)}`,
      });
      logDebug(
        "tutor",
        `Tutor JSON repair request failed, enabling plain-text fallback: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const proseResult = await requestProseFeedback(provider, ctx);
    const proseFeedback = stripModelFences(proseResult.raw);
    if (proseFeedback.trim()) {
      recordTutorOutcome("prose"); // correction shown, but not recorded in mastery this turn
      // The diagnostic is developer info; it must not ride along in `error`, which the UI
      // renders to the learner. Callers surface it behind a collapsed details toggle.
      const diagnostic = formatTutorDiagnostic(diagnosticAttempts);
      return { analysis: null, proseFeedback, diagnostic };
    }

    recordTutorOutcome("failed");
    const diagnostic = formatTutorDiagnostic([
      ...diagnosticAttempts,
      {
        label: "prose fallback",
        failure: "empty_output",
        raw: proseResult.raw,
        finish: proseResult.finish?.raw,
      },
    ]);
    return {
      analysis: null,
      diagnostic,
      error:
        "Correction failed to generate content, please retry or check model settings.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("tutor", "Tutor request failed", e);
    recordTutorOutcome("failed");
    return { analysis: null, error: `API request failed: ${msg}` };
  }
}
