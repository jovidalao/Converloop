import { z } from "zod";

import type { ChatMessage, ModelProvider } from "../providers/types";
import { toJsonSchema } from "./json-schema";
import { parseLLMJson, parseStringArrayLoose } from "./parse-llm-json";

export interface QuickfireTopicsContext {
  targetLanguage: string;
  nativeLanguage: string;
  level: string;
  profileSlice?: string;
  /** Short labels of mastery items the learner is currently struggling with. */
  weakItems?: string[];
  /** Titles of recently practiced conversations (avoid repeating these). */
  recentTopics?: string[];
  /** Scenarios just shown to the learner on a regenerate — return a clearly different set, not rewordings of these. */
  avoid?: string[];
  /** Random source — injectable so tests are deterministic; defaults to Math.random. Drives lens sampling + shuffle. */
  rng?: () => number;
}

// Structured output: an object wrapper (json_schema requires an object root) around the topic list.
const QuickfireTopics = z.object({
  topics: z.array(z.string()).min(1),
});

// Over-generate then sample: ask for OVERGEN_COUNT corner cases and randomly show TARGET_COUNT, so each refresh
// surfaces a different slice. Generous token budget covers the larger list plus reasoning headroom — on thinking
// models (e.g. Gemini *-flash) reasoning tokens count against maxOutputTokens, so too tight a cap gets consumed by
// thinking and the model returns an empty text part.
const MAX_OUTPUT_TOKENS = 3072;
const MAX_TOPIC_CHARS = 56;
const TARGET_COUNT = 8; // chips shown
const OVERGEN_COUNT = 16; // scenarios requested from the model, before sampling down to TARGET_COUNT
const LENS_SAMPLE = 4; // corner-case angles injected into the prompt per call
const FALLBACK_TOPICS_ZH = [
  "处理快递送错地址",
  "向店员反馈多收费问题",
  "预约看医生",
  "和同事委婉改时间",
  "机场值机遇到问题",
  "退换有瑕疵商品",
  "房东拖延维修",
  "第一次见面闲聊",
];
const FALLBACK_TOPICS_EN = [
  "Handling a wrong delivery",
  "Disputing an overcharge",
  "Booking a doctor appointment",
  "Rescheduling with a coworker",
  "Airport check-in problem",
  "Returning a faulty product",
  "Chasing a landlord repair",
  "Small talk with someone new",
];

// Corner-case "lenses": twist dimensions that turn an ordinary errand into the awkward, off-script version people
// actually freeze on. A random few are injected each call so successive refreshes mine different kinds of corner case
// (and the changing prompt is what gives the regenerate real variety).
const CORNER_CASE_LENSES = [
  "something goes wrong (item arrives broken, the system is down, your booking was lost, you were charged twice)",
  "the other party resists (a clerk refuses, a landlord stalls, support keeps deflecting, a doctor brushes off your concern)",
  "social awkwardness (you blanked on their name, you must correct someone senior, decline without offending, deflect an over-personal question)",
  "an ambiguous gray area (is this covered by warranty, whose fault is it, the rule or policy is genuinely unclear)",
  "time pressure or a surprise (an unexpected follow-up question, you have to backtrack or improvise on the spot)",
  "a register or culture gap (you came off too formal or too casual, an idiom or joke you didn't catch, small talk drifting off-script)",
  "the mistake is yours (you were late, you misread something, you broke or lost it and have to own up)",
  "you have to push (negotiate, ask for an exception, chase someone who keeps putting you off)",
];

export function prefersChineseLabels(nativeLanguage: string): boolean {
  return /chinese|mandarin|zh|中文|汉语|漢語|普通话|普通話/i.test(
    nativeLanguage,
  );
}

function fallbackTopics(nativeLanguage: string): string[] {
  return prefersChineseLabels(nativeLanguage)
    ? FALLBACK_TOPICS_ZH
    : FALLBACK_TOPICS_EN;
}

function cleanTopicLabel(raw: string): string {
  let s = raw.normalize("NFKC").trim();
  s = s.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/u, "");
  s = s.replace(/^awkward\s+corner\s+case\)?\s*[:：)\-*]+\s*/i, "");
  s = s.replace(
    /^(?:topic|scenario|item|label|话题|场景)\s*(?:\d+\s*)?[:：.)-]+\s*/i,
    "",
  );
  // (Intentionally no trailing " — clause" / " : clause" strip: for corner cases the part after a dash/colon is
  // usually the essential twist, not throwaway meta. Over-long labels are dropped by the MAX_TOPIC_CHARS filter.)
  s = s.replace(/^\*\*/, "").replace(/\*\*$/, "");
  return s.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
}

export function dedupeAndFilterTopics(rawTopics: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawTopics) {
    const topic = cleanTopicLabel(raw);
    if (!topic || topic.length > MAX_TOPIC_CHARS) continue;
    const key = topic.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
  }
  return out;
}

// Fisher–Yates shuffle. rng is injectable so tests stay deterministic (defaults to Math.random).
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseLooseListLines(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const listLike =
      /^\s*(?:[-*•]+|\d+[.)])\s+/.test(trimmed) ||
      /^\s*(?:topic|scenario|item|label|话题|场景)\s*\d*\s*[:：.)-]/i.test(
        trimmed,
      ) ||
      /^awkward\s+corner\s+case/i.test(trimmed);
    if (listLike) out.push(trimmed);
  }
  return out;
}

// Pull topic strings out of a response when structured validation didn't apply (an endpoint that ignored json_schema
// and emitted a bare/fenced array, or an object under a different field). Best-effort so we surface topics instead of
// nothing rather than a clean failure.
export function salvageTopics(raw: string): string[] {
  const loose = parseStringArrayLoose(raw);
  if (loose.length > 0) return loose;
  const parsed = parseLLMJson(raw);
  if (parsed.ok && parsed.value && typeof parsed.value === "object") {
    const obj = parsed.value as Record<string, unknown>;
    const arr = obj.topics ?? obj.scenarios ?? obj.items;
    if (Array.isArray(arr))
      return arr.filter((s): s is string => typeof s === "string");
  }
  return parseLooseListLines(raw);
}

// Recommend umbrella scenarios for a rapid-fire Q&A drill, grounded in the learner's records. Rather than the obvious
// everyday topics (which the model collapses onto), it mines CORNER CASES — the awkward, off-script moments people hit
// but rarely rehearse — by injecting a random few "lens" angles each call and over-generating, then sampling down to
// TARGET_COUNT. That variety in the prompt is what makes regenerate actually return different sets. Each topic is a
// short chip label in the learner's native language; on commit it becomes the umbrella scenario fed to the quickfire
// agent. Uses structured output so weaker OpenAI-compatible endpoints reliably return the full list (not 0–1 items).
export async function generateQuickfireTopics(
  provider: ModelProvider,
  ctx: QuickfireTopicsContext,
  // Diagnostics sink for the debug panel: the raw model response and whether we fell back to the hardcoded list
  // (the latter is the tell-tale of a silently-failing fetch returning the same content every time).
  onDebug?: (info: { raw: string; usedFallback: boolean }) => void,
): Promise<string[]> {
  const rng = ctx.rng ?? Math.random;
  const lensBlock = shuffle(CORNER_CASE_LENSES, rng)
    .slice(0, LENS_SAMPLE)
    .map((l) => `- ${l}`)
    .join("\n");
  const profileBlock = ctx.profileSlice?.trim()
    ? `\nLearner profile (interests, goals, job/role — make topics personal to them):\n${ctx.profileSlice.trim()}\n`
    : "";
  const weakBlock =
    ctx.weakItems && ctx.weakItems.length > 0
      ? `\nThings this learner currently struggles with (bias some scenarios toward situations that would naturally exercise these):\n${ctx.weakItems
          .map((w) => `- ${w}`)
          .join("\n")}\n`
      : "";
  const recentBlock =
    ctx.recentTopics && ctx.recentTopics.length > 0
      ? `\nTopics they have practiced recently (offer fresh, clearly different scenarios — do not repeat these):\n${ctx.recentTopics
          .map((tpc) => `- ${tpc}`)
          .join("\n")}\n`
      : "";
  const avoidBlock =
    ctx.avoid && ctx.avoid.length > 0
      ? `\nThe learner just saw the scenarios below and asked for a DIFFERENT set. Do NOT return any of these or lightly reworded versions of them — propose genuinely new, distinct scenarios:\n${ctx.avoid
          .map((a) => `- ${a}`)
          .join("\n")}\n`
      : "";

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `You are a ${ctx.targetLanguage} speaking coach for a ${ctx.nativeLanguage} speaker at ${ctx.level} level. You are proposing umbrella scenarios for a RAPID-FIRE Q&A drill: each scenario is a real-life setting in which you will later fire many small, concrete situations for the learner to respond to on the spot.
${profileBlock}${weakBlock}${recentBlock}${avoidBlock}
Dig out CORNER CASES: situations people genuinely run into but almost never rehearse — the moment something goes off-script and they freeze. Steer away from generic, comfortable topics (a bare "ordering coffee" or "returning an item" is too easy on its own).

For THIS batch, lean into these angles — take ordinary settings and twist them into the awkward version:
${lensBlock}

Propose ${OVERGEN_COUNT} distinct corner-case scenarios this learner is genuinely likely to hit in everyday life and work.

Rules:
- Each scenario MUST carry a specific complication, not the bland version. E.g. not "returning an item" but "returning an item the clerk insists you already used"; not "seeing a doctor" but "a doctor pressing you on a symptom you hadn't thought about".
- Each topic is a SHORT, sharp label in ${ctx.nativeLanguage} that conveys the twist in a single phrase (a handful of words, no colon/dash sub-clauses), short enough to fit on a chip.
- Cross the angles above with this learner's life — their profile/interests, the weak points listed, and concrete daily/work settings. When records are thin, use common but still non-obvious real-life corner cases.
- Span different settings and angles; no two near-duplicates, and don't relist anything in the avoid list.

Return a JSON object of the form {"topics": ["…", "…"]} with ${OVERGEN_COUNT} entries — nothing else.`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 1.0,
    maxTokens: MAX_OUTPUT_TOKENS,
    jsonSchema: toJsonSchema("QuickfireTopics", QuickfireTopics),
    meta: { label: "quickfire-topics" },
  });

  const parsed = parseLLMJson(raw);
  let topics: string[] = [];
  if (parsed.ok) {
    const validated = QuickfireTopics.safeParse(parsed.value);
    if (validated.success) topics = validated.data.topics;
  }
  if (topics.length === 0) topics = salvageTopics(raw);
  const filtered = dedupeAndFilterTopics(topics);
  const usedFallback = filtered.length === 0;
  const pool = usedFallback
    ? dedupeAndFilterTopics(fallbackTopics(ctx.nativeLanguage))
    : filtered;
  // Sample down: shuffle the (over-generated) pool and take TARGET_COUNT, so each refresh shows a different slice.
  const finalTopics = shuffle(pool, rng).slice(0, TARGET_COUNT);

  onDebug?.({ raw, usedFallback });
  return finalTopics;
}
