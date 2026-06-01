/** 从 LLM 原始文本里抽出 JSON(去掉 markdown 代码块、前后说明文字)。 */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (fenced) return fenced[1].trim();

  const inlineFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (inlineFence) return inlineFence[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

/** 粗判是否像导师 JSON(用于决定是否触发 json_object 回退)。 */
export function isLikelyTutorJsonPayload(raw: string): boolean {
  const text = extractJsonText(raw);
  if (!text?.trimStart().startsWith("{")) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function proseInsteadOfJsonHint(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.startsWith("{")) return null;
  if (
    /->\s*Type:/i.test(t) ||
    /\bWait,\s+is\b/i.test(t) ||
    /Signal:\s*`/i.test(t) ||
    (/```/.test(t) && !t.includes("{"))
  ) {
    return "模型返回了推理过程而非 JSON;请确认代理支持结构化输出(tool/json_schema),或换用官方端点/模型。";
  }
  return null;
}

export function parseLLMJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = extractJsonText(raw);
  if (!text) {
    return { ok: false, error: "模型返回空内容" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const repaired = text.replace(/,\s*([}\]])/g, "$1");
    if (repaired !== text) {
      try {
        return { ok: true, value: JSON.parse(repaired) };
      } catch {
        // 继续返回原始错误,便于定位模型真正输出了什么。
      }
    }
    const hint = e instanceof Error ? e.message : String(e);
    const prose = proseInsteadOfJsonHint(text);
    const prefix = prose ?? `返回内容不是合法 JSON(${hint})`;
    return {
      ok: false,
      error: `${prefix},开头: ${text.slice(0, 120)}…`,
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
const MASTERY_TYPES = new Set([
  "vocab",
  "grammar",
  "collocation",
  "error_pattern",
  "expression_gap",
]);
const GAP_KEY_ITEM_TYPES = new Set(["vocab", "grammar", "collocation"]);
const SIGNALS = new Set(["correct", "introduced"]);

function pickEnum(value: unknown, allowed: Set<string>): unknown {
  if (typeof value !== "string") return value;
  const lower = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (allowed.has(lower)) return lower;
  for (const item of allowed) {
    if (item.includes(lower) || lower.includes(item)) return item;
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

/** 把模型常见的小偏差(大小写、缺数组)修到 Zod 能吃的形状,不捏造字段。 */
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

  // expression_gap 可选:存在时把 key_items 的 mastery_type 规整到合法值。
  let expression_gap = readAlias(o, ["expression_gap", "expressionGap", "gap"]);
  if (expression_gap === undefined || expression_gap === "")
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
  return parts.slice(0, 4).join("; ") || "字段不符合 schema";
}
