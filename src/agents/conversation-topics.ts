import { z } from "zod";

import type { ChatMessage, ModelProvider } from "../providers/types";
import { toJsonSchema } from "./json-schema";
import { parseLLMJson } from "./parse-llm-json";
import {
  dedupeAndFilterTopics,
  prefersChineseLabels,
  salvageTopics,
  shuffle,
} from "./quickfire-topics";

export interface ConversationTopicsContext {
  targetLanguage: string;
  nativeLanguage: string;
  level: string;
  profileSlice?: string;
  /** Titles of recently practiced conversations (offer fresh, clearly different topics — don't repeat these). */
  recentTopics?: string[];
  /** Topics just shown to the learner on a regenerate — return a clearly different set, not rewordings of these. */
  avoid?: string[];
  /** Random source — injectable so tests are deterministic; defaults to Math.random. Drives lens sampling + shuffle. */
  rng?: () => number;
}

// Structured output: an object wrapper (json_schema requires an object root) around the topic list.
const ConversationTopics = z.object({
  topics: z.array(z.string()).min(1),
});

// Over-generate then sample, so each refresh surfaces a different slice (mirrors quickfire-topics). The token budget
// covers the larger list plus reasoning headroom — on thinking models reasoning tokens count against maxOutputTokens,
// so too tight a cap gets consumed by thinking and the model returns an empty text part.
const MAX_OUTPUT_TOKENS = 3072;
const TARGET_COUNT = 8; // chips shown
const OVERGEN_COUNT = 16; // topics requested from the model, before sampling down to TARGET_COUNT
const LENS_SAMPLE = 4; // conversation angles injected into the prompt per call

const FALLBACK_TOPICS_ZH = [
  "聊聊最近看的电影或剧",
  "周末是怎么过的",
  "理想的旅行目的地",
  "最近在忙的项目",
  "最爱的一道家乡菜",
  "工作里遇到的趣事",
  "想养成的新习惯",
  "小时候难忘的回忆",
];
const FALLBACK_TOPICS_EN = [
  "A movie or show you watched lately",
  "How your weekend went",
  "A dream travel destination",
  "What you're working on now",
  "Your favorite home-cooked dish",
  "A funny moment at work",
  "A new habit you want to build",
  "A vivid childhood memory",
];

// Conversation "lenses": angles that turn a blank-page opening into a concrete, easy-to-engage prompt. A random few
// are injected each call so successive refreshes mine different kinds of topic (and the changing prompt is what gives
// the regenerate real variety).
const CONVERSATION_LENSES = [
  "everyday life right now (what their week has been like, a small win or annoyance, plans for the weekend)",
  "an interest or hobby of theirs (what they're into lately, a recommendation they'd give, something they want to try)",
  "an opinion or light debate (a preference with a reason, an unpopular take, this-or-that)",
  "work and study (a project, something they learned, a workplace culture quirk)",
  "a memory or story (a trip, a childhood moment, the best/worst thing that happened recently)",
  "food and places (a dish they love, a spot worth visiting, a craving)",
  "a hypothetical or daydream (if they had a free day / extra money / a superpower, where they'd live)",
  "culture and trends (a show/song/book everyone's talking about, a tradition, a recent change they noticed)",
];

function fallbackTopics(nativeLanguage: string): string[] {
  return prefersChineseLabels(nativeLanguage)
    ? FALLBACK_TOPICS_ZH
    : FALLBACK_TOPICS_EN;
}

// Recommend conversation topics for the new-chat start page, grounded in the learner's profile and recent topics. Each
// topic becomes a chip in the learner's native language; on commit it seeds an AI-opened conversation (the partner
// starts the chat on that topic). Like quickfire-topics, it over-generates and samples down — injecting a random few
// "lens" angles each call — so a regenerate returns a genuinely different set rather than rewordings. Uses structured
// output so weaker OpenAI-compatible endpoints reliably return the full list (not 0–1 items).
export async function generateConversationTopics(
  provider: ModelProvider,
  ctx: ConversationTopicsContext,
  // Reports whether the result is the hardcoded fallback (rather than a real model result), so callers can choose not
  // to cache it.
  onResult?: (info: { usedFallback: boolean }) => void,
): Promise<string[]> {
  const rng = ctx.rng ?? Math.random;
  const lensBlock = shuffle(CONVERSATION_LENSES, rng)
    .slice(0, LENS_SAMPLE)
    .map((l) => `- ${l}`)
    .join("\n");
  const profileBlock = ctx.profileSlice?.trim()
    ? `\nLearner profile (interests, goals, job/role — make topics personal to them):\n${ctx.profileSlice.trim()}\n`
    : "";
  const recentBlock =
    ctx.recentTopics && ctx.recentTopics.length > 0
      ? `\nTopics they have practiced recently (offer fresh, clearly different topics — do not repeat these):\n${ctx.recentTopics
          .map((tpc) => `- ${tpc}`)
          .join("\n")}\n`
      : "";
  const avoidBlock =
    ctx.avoid && ctx.avoid.length > 0
      ? `\nThe learner just saw the topics below and asked for a DIFFERENT set. Do NOT return any of these or lightly reworded versions of them — propose genuinely new, distinct topics:\n${ctx.avoid
          .map((a) => `- ${a}`)
          .join("\n")}\n`
      : "";

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `You are a ${ctx.targetLanguage} conversation partner for a ${ctx.nativeLanguage} speaker at ${ctx.level} level. You are proposing topics to KICK OFF a fresh casual conversation: the learner picks one and you open the chat on it, drawing them into talking.
${profileBlock}${recentBlock}${avoidBlock}
Propose inviting, concrete conversation starters this learner would actually enjoy talking about — warm and low-pressure, the kind of thing a friend would bring up. Steer away from dry textbook prompts and heavy or sensitive subjects.

For THIS batch, lean into these angles:
${lensBlock}

Propose ${OVERGEN_COUNT} distinct topics.

Rules:
- Each topic is a SHORT, inviting label in ${ctx.nativeLanguage} (a handful of words, no colon/dash sub-clauses), short enough to fit on a chip.
- Make them concrete and personal — tie them to this learner's profile/interests where you can; when records are thin, use broadly relatable everyday topics.
- Each topic should be easy and fun to start talking about, not an exam question.
- Span different angles and settings; no two near-duplicates, and don't relist anything in the avoid list.

Return a JSON object of the form {"topics": ["…", "…"]} with ${OVERGEN_COUNT} entries — nothing else.`,
    },
  ];

  const raw = await provider.generate({
    messages,
    temperature: 1.0,
    maxTokens: MAX_OUTPUT_TOKENS,
    jsonSchema: toJsonSchema("ConversationTopics", ConversationTopics),
    meta: { label: "conversation-topics" },
  });

  const parsed = parseLLMJson(raw);
  let topics: string[] = [];
  if (parsed.ok) {
    const validated = ConversationTopics.safeParse(parsed.value);
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

  onResult?.({ usedFallback });
  return finalTopics;
}
