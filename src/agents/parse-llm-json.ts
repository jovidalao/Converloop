import {
  GAP_KEY_ITEM_TYPE_VALUES,
  MASTERY_TYPE_VALUES,
  MASTERY_UPDATE_SIGNAL_VALUES,
} from "../db/mastery-values";

/** Only strip markdown fences that fully wrap JSON; do not attempt to extract objects from mixed text. */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (!trimmed.startsWith("```")) return trimmed;

  const firstLineEnd = trimmed.indexOf("\n");
  if (firstLineEnd < 0) return trimmed;

  const opener = trimmed.slice(3, firstLineEnd).trim().toLowerCase();
  if (opener && opener !== "json") return trimmed;

  const body = trimmed.slice(firstLineEnd + 1);
  const closing = body.lastIndexOf("```");
  if (closing < 0 || body.slice(closing + 3).trim()) return trimmed;
  return body.slice(0, closing).trim();
}

/**
 * Extract string elements from a JSON array of strings, tolerating a leading
 * ```json fence even when the closing fence is missing, and a truncated array
 * (e.g. the model hit its token limit mid-element). Returns every COMPLETE
 * string element and drops a trailing unterminated one.
 *
 * This exists because a truncated `["a", "b`-style response can't be repaired by
 * JSON.parse; the previous line-splitting fallback would surface the raw ```json,
 * [, and partial element as bogus "items".
 */
export function parseStringArrayLoose(raw: string): string[] {
  let text = raw.trim();

  // Strip a leading code fence even when truncation dropped the closing one.
  if (text.startsWith("```")) {
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);
    const close = text.lastIndexOf("```");
    if (close >= 0) text = text.slice(0, close);
    text = text.trim();
  }

  // Fast path: a well-formed array.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed))
      return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    // Fall through to salvage complete elements from a truncated array.
  }

  const start = text.indexOf("[");
  if (start < 0) return [];
  const out: string[] = [];
  let i = start + 1;
  const n = text.length;
  while (i < n) {
    // Skip whitespace/commas to the next element; stop at the array close.
    while (i < n && text[i] !== '"') {
      if (text[i] === "]") return out;
      i++;
    }
    if (i >= n) break;
    // Find the matching closing quote, honoring escape sequences.
    let j = i + 1;
    let closed = false;
    while (j < n) {
      if (text[j] === "\\") {
        j += 2;
        continue;
      }
      if (text[j] === '"') {
        closed = true;
        break;
      }
      j++;
    }
    if (!closed) break; // truncated final element
    try {
      const s = JSON.parse(text.slice(i, j + 1)); // let JSON decode escapes
      if (typeof s === "string") out.push(s);
    } catch {
      // Skip a malformed span and keep scanning.
    }
    i = j + 1;
  }
  return out;
}

function stripTrailingJsonCommas(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

function proseInsteadOfJsonHint(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.startsWith("{")) return null;
  const lower = t.toLowerCase();
  if (
    t.includes("-> Type:") ||
    lower.includes("wait, is") ||
    t.includes("Signal: `") ||
    (t.includes("```") && !t.includes("{"))
  ) {
    return "Model returned reasoning instead of JSON; confirm the provider supports structured output (tool/json_schema), or switch to an official endpoint/model.";
  }
  return null;
}

export type JsonParseFailureKind = "empty" | "invalid_json";

export function parseLLMJson(
  raw: string,
):
  | { ok: true; value: unknown }
  | { ok: false; kind: JsonParseFailureKind; error: string } {
  const text = extractJsonText(raw);
  if (!text) {
    return { ok: false, kind: "empty", error: "Model returned empty content" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const repaired = stripTrailingJsonCommas(text);
    if (repaired !== text) {
      try {
        return { ok: true, value: JSON.parse(repaired) };
      } catch {
        // Continue returning the original error to help identify what the model actually output.
      }
    }
    const hint = e instanceof Error ? e.message : String(e);
    const prose = proseInsteadOfJsonHint(text);
    const prefix = prose ?? `Response is not valid JSON (${hint})`;
    return {
      ok: false,
      kind: "invalid_json",
      error: `${prefix}, starts with: ${text.slice(0, 120)}…`,
    };
  }
}

const ISSUE_CATEGORIES = new Set([
  "grammar",
  "word_choice",
  "collocation",
  "spelling",
  "punctuation",
  "register",
  "naturalness",
]);

const SEVERITIES = new Set(["minor", "moderate", "major"]);
const MASTERY_TYPES: ReadonlySet<string> = new Set(MASTERY_TYPE_VALUES);
const GAP_KEY_ITEM_TYPES: ReadonlySet<string> = new Set(
  GAP_KEY_ITEM_TYPE_VALUES,
);
const SIGNALS: ReadonlySet<string> = new Set(MASTERY_UPDATE_SIGNAL_VALUES);

const ENUM_ALIASES: Record<string, string> = {
  auxiliary: "grammar",
  auxiliary_be: "grammar",
  clause_structure: "grammar",
  determiner: "grammar",
  pronoun: "grammar",
  tense: "grammar",
  verb_tense: "grammar",
  冠词: "grammar",
  代词: "grammar",
  动词时态: "grammar",
  助动词: "grammar",
  名词单复数: "grammar",
  句子结构: "grammar",
  语法: "grammar",
  限定词: "grammar",

  vocabulary: "vocab",
  词汇: "vocab",

  vocab: "word_choice",
  vocabulary_choice: "word_choice",
  用词: "word_choice",
  词汇选择: "word_choice",

  collocation_usage: "collocation",
  搭配: "collocation",

  spelling_error: "spelling",
  拼写: "spelling",
  拼写错误: "spelling",

  punctuation_usage: "punctuation",
  标点: "punctuation",
  标点符号: "punctuation",

  register_usage: "register",
  语体: "register",

  idiomaticity: "naturalness",
  自然度: "naturalness",

  error_pattern: "error_pattern",
  错误模式: "error_pattern",
  expression_gap: "expression_gap",
  表达缺口: "expression_gap",

  minor: "minor",
  轻微: "minor",
  moderate: "moderate",
  medium: "moderate",
  中等: "moderate",
  major: "major",
  severe: "major",
  严重: "major",

  correct: "correct",
  正确: "correct",
  introduced: "introduced",
  引入: "introduced",
};

function enumCandidates(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return [
    normalized,
    ...normalized
      .split(/[^a-z0-9_\p{Script=Han}]+/u)
      .filter((part) => part.length > 0),
  ];
}

function pickEnum(value: unknown, allowed: ReadonlySet<string>): unknown {
  if (typeof value !== "string") return value;
  const candidates = enumCandidates(value);
  for (const candidate of candidates) {
    if (allowed.has(candidate)) return candidate;
    const alias = ENUM_ALIASES[candidate];
    if (alias && allowed.has(alias)) return alias;
  }
  const lower = candidates[0];
  for (const item of allowed) {
    if (item.includes(lower) || lower.includes(item)) return item;
  }
  for (const candidate of candidates.slice(1)) {
    for (const item of allowed) {
      if (item.includes(candidate) || candidate.includes(item)) return item;
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readAlias(
  source: Record<string, unknown>,
  aliases: string[],
): unknown {
  for (const key of aliases) {
    if (Object.getOwnPropertyDescriptor(source, key)) return source[key];
  }
  return undefined;
}

function readAliasOr(
  source: Record<string, unknown>,
  aliases: string[],
  fallback: unknown,
): unknown {
  const value = readAlias(source, aliases);
  return value === undefined ? fallback : value;
}

function coerceString(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return value;
}

function coerceBoolean(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const lower = value.trim().toLowerCase();
  if (["true", "yes", "correct"].includes(lower)) return true;
  if (["false", "no", "incorrect"].includes(lower)) return false;
  return value;
}

function unwrapTutorPayload(json: unknown): unknown {
  if (Array.isArray(json) && json.length === 1)
    return unwrapTutorPayload(json[0]);
  if (!isRecord(json)) return json;
  if (
    "is_correct" in json ||
    "corrected" in json ||
    "issues" in json ||
    "mastery_updates" in json
  ) {
    return json;
  }
  const wrapped = readAlias(json, [
    "analysis",
    "tutor_analysis",
    "TutorAnalysis",
    "result",
    "data",
  ]);
  return isRecord(wrapped) ? wrapped : json;
}

/** Fix common minor deviations from models (casing, missing arrays) into a shape Zod can parse, without inventing fields. */
export function normalizeTutorPayload(json: unknown): unknown {
  json = unwrapTutorPayload(json);
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const o = json as Record<string, unknown>;

  const rawIssues = readAlias(o, ["issues", "errors", "corrections"]);
  const issues = Array.isArray(rawIssues)
    ? rawIssues.map((item) => {
        if (!isRecord(item)) return item;
        const i = item;
        return {
          ...i,
          category: pickEnum(
            readAliasOr(i, ["category", "issue_category"], i.category),
            ISSUE_CATEGORIES,
          ),
          span_original: coerceString(
            readAliasOr(
              i,
              ["span_original", "spanOriginal", "original_span", "original"],
              i.span_original,
            ),
          ),
          span_corrected: coerceString(
            readAliasOr(
              i,
              [
                "span_corrected",
                "spanCorrected",
                "corrected_span",
                "corrected",
                "correction",
                "fix",
              ],
              i.span_corrected,
            ),
          ),
          explanation: coerceString(
            readAliasOr(i, ["explanation", "reason"], i.explanation),
          ),
          severity: pickEnum(
            readAliasOr(i, ["severity", "level"], i.severity),
            SEVERITIES,
          ),
          mastery_key: coerceString(
            readAliasOr(i, ["mastery_key", "masteryKey", "key"], i.mastery_key),
          ),
          mastery_label: coerceString(
            readAliasOr(
              i,
              ["mastery_label", "masteryLabel", "label"],
              i.mastery_label,
            ),
          ),
          mastery_type: pickEnum(
            readAliasOr(
              i,
              ["mastery_type", "masteryType", "type"],
              i.mastery_type,
            ),
            MASTERY_TYPES,
          ),
        };
      })
    : [];

  const rawUpdates = readAlias(o, [
    "mastery_updates",
    "masteryUpdates",
    "updates",
    "mastery_signals",
    "masterySignals",
  ]);
  const mastery_updates = Array.isArray(rawUpdates)
    ? rawUpdates.map((item) => {
        if (!isRecord(item)) return item;
        const u = item;
        return {
          ...u,
          key: coerceString(
            readAliasOr(u, ["key", "mastery_key", "masteryKey"], u.key),
          ),
          label: coerceString(
            readAliasOr(u, ["label", "mastery_label", "masteryLabel"], u.label),
          ),
          type: pickEnum(
            readAliasOr(u, ["type", "mastery_type", "masteryType"], u.type),
            MASTERY_TYPES,
          ),
          signal: pickEnum(
            readAliasOr(u, ["signal", "kind"], u.signal),
            SIGNALS,
          ),
          evidence: coerceString(u.evidence),
        };
      })
    : [];

  // expression_gap is optional: when present, normalize key_items' mastery_type to valid values.
  // Some models emit a placeholder string ("null"/"none") instead of JSON null for "no gap";
  // coerce those to null so the schema (ExpressionGap.nullable()) doesn't reject the whole turn.
  let expression_gap = readAlias(o, ["expression_gap", "expressionGap", "gap"]);
  if (
    expression_gap === undefined ||
    (typeof expression_gap === "string" &&
      ["", "null", "none", "n/a", "nil"].includes(
        expression_gap.trim().toLowerCase(),
      ))
  )
    expression_gap = null;
  if (
    expression_gap &&
    typeof expression_gap === "object" &&
    !Array.isArray(expression_gap)
  ) {
    const g = expression_gap as Record<string, unknown>;
    const rawKeyItems = readAlias(g, ["key_items", "keyItems", "items"]);
    const key_items = Array.isArray(rawKeyItems)
      ? rawKeyItems.map((item) => {
          if (!isRecord(item)) return item;
          const k = item;
          return {
            ...k,
            text: coerceString(k.text),
            gloss: coerceString(readAliasOr(k, ["gloss", "meaning"], k.gloss)),
            mastery_key: coerceString(
              readAliasOr(
                k,
                ["mastery_key", "masteryKey", "key"],
                k.mastery_key,
              ),
            ),
            mastery_label: coerceString(
              readAliasOr(
                k,
                ["mastery_label", "masteryLabel", "label"],
                k.mastery_label,
              ),
            ),
            mastery_type: pickEnum(
              readAliasOr(
                k,
                ["mastery_type", "masteryType", "type"],
                k.mastery_type,
              ),
              GAP_KEY_ITEM_TYPES,
            ),
          };
        })
      : [];
    expression_gap = {
      ...g,
      mastery_key: coerceString(
        readAliasOr(g, ["mastery_key", "masteryKey", "key"], g.mastery_key),
      ),
      mastery_label: coerceString(
        readAliasOr(
          g,
          ["mastery_label", "masteryLabel", "label"],
          g.mastery_label,
        ),
      ),
      original: coerceString(
        readAliasOr(
          g,
          ["original", "original_text", "user_original"],
          g.original,
        ),
      ),
      target_expression: coerceString(
        readAliasOr(
          g,
          ["target_expression", "targetExpression", "target", "translation"],
          g.target_expression,
        ),
      ),
      template: coerceString(
        readAliasOr(g, ["template", "pattern"], g.template),
      ),
      explanation: coerceString(
        readAliasOr(g, ["explanation", "reason"], g.explanation),
      ),
      key_items,
      usage_note: coerceString(
        readAliasOr(g, ["usage_note", "usageNote", "note"], g.usage_note),
      ),
    };
  }

  return {
    ...o,
    is_correct: coerceBoolean(
      readAliasOr(o, ["is_correct", "isCorrect", "correct"], o.is_correct),
    ),
    corrected:
      coerceString(
        readAliasOr(
          o,
          [
            "corrected",
            "corrected_sentence",
            "correctedSentence",
            "corrected_text",
          ],
          o.corrected,
        ),
      ) ?? "",
    natural:
      coerceString(
        readAliasOr(
          o,
          [
            "natural",
            "natural_sentence",
            "naturalSentence",
            "natural_text",
            "idiomatic",
            "idiomatic_sentence",
          ],
          o.natural,
        ),
      ) ?? "",
    issues,
    mastery_updates,
    expression_gap,
  };
}

export function formatZodError(error: {
  flatten: () => {
    fieldErrors: Record<string, string[]>;
    formErrors: string[];
  };
}): string {
  const flat = error.flatten();
  const parts: string[] = [];
  if (flat.formErrors.length) parts.push(...flat.formErrors);
  for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
    if (msgs?.length) parts.push(`${field}: ${msgs.join(", ")}`);
  }
  return parts.slice(0, 4).join("; ") || "Fields do not match schema";
}
