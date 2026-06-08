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
}

// Structured output: an object wrapper (json_schema requires an object root) around the topic list.
const QuickfireTopics = z.object({
  topics: z.array(z.string()).min(1),
});

const MAX_OUTPUT_TOKENS = 700;
const MAX_TOPIC_CHARS = 56;
const TARGET_COUNT = 8;
const MAX_TOPICS = 10;
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

function prefersChineseLabels(nativeLanguage: string): boolean {
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
  s = s.replace(/\s+(?:[-–—]|:|：)\s+.+$/u, "");
  s = s.replace(/^\*\*/, "").replace(/\*\*$/, "");
  return s.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
}

function dedupeAndFilterTopics(rawTopics: string[]): string[] {
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
function salvageTopics(raw: string): string[] {
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

// Recommend umbrella scenarios for a rapid-fire Q&A drill, grounded in the learner's records. Each topic is a short
// chip label in the learner's native language; on commit it becomes the umbrella scenario fed to the quickfire agent.
// Uses structured output so weaker OpenAI-compatible endpoints reliably return the full list (not 0–1 items).
export async function generateQuickfireTopics(
  provider: ModelProvider,
  ctx: QuickfireTopicsContext,
): Promise<string[]> {
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

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `You are a ${ctx.targetLanguage} speaking coach for a ${ctx.nativeLanguage} speaker at ${ctx.level} level. You are proposing umbrella scenarios for a RAPID-FIRE Q&A drill: each scenario is a real-life setting in which you will later fire many small, concrete situations for the learner to respond to on the spot.
${profileBlock}${weakBlock}${recentBlock}
Propose exactly ${TARGET_COUNT} distinct umbrella scenarios that THIS learner is genuinely likely to face in everyday life and work. Include practical situations people rarely rehearse but actually run into (e.g. a parcel left at the wrong door, disputing a wrong charge, declining a meeting politely, a doctor asking unexpected follow-ups, small talk that drifts off-script, a landlord dodging a repair).

Rules:
- Each topic is a SHORT label naming the scenario, written in ${ctx.nativeLanguage} (e.g. the ${ctx.nativeLanguage} for "Returning a faulty product", "Airport check-in problems", "Small talk with a new coworker").
- Ground them in the learner's life: blend their profile/interests, the weak points above, and practical daily/work situations. When records are thin, fall back to common, useful real-life scenarios.
- Span different settings (home, work, shops, travel, healthcare, social) — no two near-duplicates.
- Keep each label short enough to fit on a chip (a few words).

Return a JSON object of the form {"topics": ["…", "…"]} with exactly ${TARGET_COUNT} entries — nothing else.`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 0.9,
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
  const finalTopics =
    filtered.length > 0
      ? filtered
      : dedupeAndFilterTopics(fallbackTopics(ctx.nativeLanguage));

  return finalTopics.slice(0, MAX_TOPICS);
}
