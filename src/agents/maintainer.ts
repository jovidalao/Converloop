import type { MaintainerData } from "../db/mastery";
import { writeProfile } from "../profile/profile";
import { applyPreservedMyNotes, sanityCheck } from "../profile/sanity";
import type { ChatMessage, ModelProvider } from "../providers/types";

export interface MaintainerInput {
  nativeLanguage: string;
  targetLanguage: string;
  level: string;
  currentMd: string;
  data: MaintainerData;
  recentlyIntroduced: { key: string; label: string }[];
  transcript: string;
}

export interface MaintainerResult {
  written: boolean;
  reason: string;
  profile?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 见 docs/profile-maintainer-agent.md#system-prompt
function systemPrompt(input: MaintainerInput): string {
  return `You maintain a learner's profile document for a ${input.nativeLanguage} speaker
learning ${input.targetLanguage}. The profile is read by a conversation agent to
personalize replies, and by the user, who may edit it by hand.

You are given: the CURRENT profile, structured mastery data (with real counts),
and a recent conversation transcript. Produce an UPDATED profile.

HARD RULES
- Update, do not rewrite from scratch. Preserve the structure and wording of
  sections you have no new evidence to change.
- Ground every statement in the provided data or transcript. Never invent
  weaknesses, interests, or progress that the inputs do not support.
- The structured mastery data is the source of truth for what the user struggles
  with or has mastered. The transcript is the source of truth for interests,
  tone, and conversational tendencies. Do not contradict the counts.
- "## About me" holds DURABLE personal facts the user has shared about their life
  (job, studies and what stage, location, family, ongoing situations) so the
  conversation agent remembers who they are across sessions. Add or update a fact
  only when the transcript clearly states it; carry existing facts forward; drop
  ones the user has contradicted. Never guess or infer beyond what was said. Skip
  one-off small talk that is not a lasting fact about the person.
- NEVER touch the "## My notes" section — copy it through verbatim. It belongs to
  the user.
- Keep it concise: at most 6 bullets per section. Prune items that are stale
  (not seen recently) or resolved (now "known"). Quality over completeness — this
  goes into a prompt every turn.
- Only change the level (e.g. B1 → B2) when the data clearly justifies it, and
  keep the same level otherwise.
- Update the "updated" date in the header to ${today()}.

OUTPUT
- Return ONLY the full updated profile in Markdown, using exactly these section
  headers, in this order:
    # Learner Profile  ·  ${input.nativeLanguage} → ${input.targetLanguage} · ${input.level} · updated ${today()}
    ## About me
    ## Working on
    ## Comfortable with
    ## Avoids / rarely attempts
    ## Interests
    ## Recently introduced
    ## My notes
- No commentary, no explanation, no code fences. Just the document.`;
}

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days <= 0 ? "today" : `${days}d ago`;
}

function userPrompt(input: MaintainerInput): string {
  const weakRows =
    input.data.weak
      .map((w) => {
        const details = [
          w.example
            ? `example="${w.example.replace(/\s+/g, " ").trim()}"`
            : null,
          w.notes ? `note="${w.notes.replace(/\s+/g, " ").trim()}"` : null,
        ].filter(Boolean);
        return `- [${w.type}] ${w.label} (${w.key}) — ${w.errorCount}/${w.seenCount} errors, status=${w.status}, last seen ${ago(w.lastSeenAt)}${
          details.length ? `; ${details.join("; ")}` : ""
        }`;
      })
      .join("\n") || "(none)";
  const knownRows =
    input.data.recentlyKnown.map((k) => `- ${k.label} (${k.key})`).join("\n") ||
    "(none)";
  const introRows =
    input.recentlyIntroduced.map((i) => `- ${i.label} (${i.key})`).join("\n") ||
    "(none)";

  return `=== CURRENT PROFILE ===
${input.currentMd}

=== MASTERY DATA (source of truth for strengths/weaknesses) ===
Struggling / learning (top 15):
${weakRows}
Recently reached "known":
${knownRows}
Recently introduced:
${introRows}

=== RECENT TRANSCRIPT (source of truth for interests/tone) ===
${input.transcript || "(none)"}

Produce the updated profile now.`;
}

// 偶尔会包 ``` 代码围栏,去掉。
function stripFences(md: string): string {
  const t = md.trim();
  if (!t.startsWith("```")) return t;
  return t
    .replace(/^```[a-zA-Z]*\n/, "")
    .replace(/\n```$/, "")
    .trim();
}

// 后台跑:产出新 MD → sanity check → 通过才原子写入,否则保留旧 MD。
export async function runMaintainer(
  provider: ModelProvider,
  input: MaintainerInput,
): Promise<MaintainerResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input) },
    { role: "user", content: userPrompt(input) },
  ];
  let newMd: string;
  try {
    newMd = stripFences(
      await provider.generate({ messages, temperature: 0.3 }),
    );
  } catch (e) {
    return {
      written: false,
      reason: `LLM 调用失败:${e instanceof Error ? e.message : String(e)}`,
    };
  }

  newMd = applyPreservedMyNotes(input.currentMd, newMd);
  const sane = sanityCheck(input.currentMd, newMd);
  if (!sane.ok)
    return { written: false, reason: sane.reason ?? "sanity check 未通过" };

  await writeProfile(newMd);
  return { written: true, reason: "updated", profile: newMd };
}
