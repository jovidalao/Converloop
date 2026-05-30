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

export function parseLLMJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = extractJsonText(raw);
  if (!text) {
    return { ok: false, error: "模型返回空内容" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const hint = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `返回内容不是合法 JSON(${hint}),开头: ${text.slice(0, 120)}…`,
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
const MASTERY_TYPES = new Set(["vocab", "grammar", "collocation", "error_pattern"]);
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

/** 把模型常见的小偏差(大小写、缺数组)修到 Zod 能吃的形状,不捏造字段。 */
export function normalizeTutorPayload(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const o = json as Record<string, unknown>;

  const issues = Array.isArray(o.issues)
    ? o.issues.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const i = item as Record<string, unknown>;
        return {
          ...i,
          category: pickEnum(i.category, ISSUE_CATEGORIES),
          severity: pickEnum(i.severity, SEVERITIES),
          mastery_type: pickEnum(i.mastery_type, MASTERY_TYPES),
        };
      })
    : [];

  const mastery_updates = Array.isArray(o.mastery_updates)
    ? o.mastery_updates.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const u = item as Record<string, unknown>;
        return {
          ...u,
          type: pickEnum(u.type, MASTERY_TYPES),
          signal: pickEnum(u.signal, SIGNALS),
        };
      })
    : [];

  return {
    ...o,
    is_correct: typeof o.is_correct === "string" ? o.is_correct === "true" : o.is_correct,
    corrected: typeof o.corrected === "string" ? o.corrected : o.corrected ?? "",
    natural: typeof o.natural === "string" ? o.natural : o.natural ?? "",
    issues,
    mastery_updates,
  };
}

export function formatZodError(error: { flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] } }): string {
  const flat = error.flatten();
  const parts: string[] = [];
  if (flat.formErrors.length) parts.push(...flat.formErrors);
  for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
    if (msgs?.length) parts.push(`${field}: ${msgs.join(", ")}`);
  }
  return parts.slice(0, 4).join("; ") || "字段不符合 schema";
}
