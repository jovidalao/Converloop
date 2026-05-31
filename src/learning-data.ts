import type { TutorAnalysis } from "./agents/schema";
import type { AppConfig } from "./config";
import type {
  LearningAgentMeta,
  LearningDataScope,
} from "./db/learning-agents";
import { getAllMastery, getReviewDueList, getWeakList } from "./db/mastery";
import { getProficiencySnapshot } from "./db/proficiency";
import type { MasteryItem, Turn } from "./db/schema";
import { getRecentTurns, getTurnsSince, parseTurnFeedback } from "./db/turns";
import { profileSliceForConversation, readProfile } from "./profile/profile";

function oneLine(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function formatMasteryItems(items: MasteryItem[], limit = 12): string {
  if (items.length === 0) return "(none)";
  return items
    .slice(0, limit)
    .map((item) => {
      const bits = [
        item.example ? `example="${oneLine(item.example, 120)}"` : null,
        item.notes ? `note="${oneLine(item.notes, 120)}"` : null,
      ].filter(Boolean);
      return `- [${item.type}/${item.status}] ${item.label} (${item.key})${
        bits.length ? ` — ${bits.join("; ")}` : ""
      }`;
    })
    .join("\n");
}

function formatWeakItems(
  items: Awaited<ReturnType<typeof getWeakList>>,
): string {
  if (items.length === 0) return "(none)";
  return items
    .map((item) => {
      const bits = [
        item.example ? `example="${oneLine(item.example, 120)}"` : null,
        item.notes ? `note="${oneLine(item.notes, 120)}"` : null,
      ].filter(Boolean);
      return `- [${item.type}/${item.status}] ${item.label} (${item.key})${
        bits.length ? ` — ${bits.join("; ")}` : ""
      }`;
    })
    .join("\n");
}

function compactFeedback(a: TutorAnalysis | null): string {
  if (!a) return "";
  const parts: string[] = [];
  if (a.expression_gap) {
    parts.push(
      `gap=${oneLine(a.expression_gap.mastery_label)} -> ${oneLine(
        a.expression_gap.target_expression,
      )}`,
    );
  }
  if (a.issues.length > 0) {
    parts.push(
      `issues=${a.issues
        .map(
          (i) =>
            `${i.mastery_label}: ${i.span_original} -> ${i.span_corrected}`,
        )
        .join("; ")}`,
    );
  }
  return parts.join(" | ");
}

function formatTurns(turns: Turn[], limit = 10): string {
  if (turns.length === 0) return "(none)";
  return turns
    .slice(-limit)
    .map((turn) => {
      const { analysis, prose } = parseTurnFeedback(turn.analysisJson);
      const feedback =
        compactFeedback(analysis) || (prose ? oneLine(prose) : "");
      return `- User: ${oneLine(turn.userInput, 160)}\n  Reply: ${oneLine(
        turn.reply,
        180,
      )}${feedback ? `\n  Feedback: ${feedback}` : ""}`;
    })
    .join("\n");
}

function startOfLocalToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hasScope(
  scopes: LearningDataScope[],
  scope: LearningDataScope,
): boolean {
  return scopes.includes(scope);
}

export async function buildLearningDataContext(
  agent: LearningAgentMeta,
  config: AppConfig,
): Promise<string> {
  const scopes = agent.dataScopes;
  const sections: string[] = [];

  const [
    profileMd,
    weakList,
    allMastery,
    dueReview,
    todayTurns,
    recentTurns,
    proficiency,
  ] = await Promise.all([
    hasScope(scopes, "profile") ? readProfile(config) : Promise.resolve(""),
    hasScope(scopes, "weak_all") ? getWeakList(15) : Promise.resolve([]),
    hasScope(scopes, "weak_grammar") || hasScope(scopes, "expression_gaps")
      ? getAllMastery()
      : Promise.resolve([]),
    hasScope(scopes, "due_review") ? getReviewDueList(8) : Promise.resolve([]),
    hasScope(scopes, "today_turns")
      ? getTurnsSince(startOfLocalToday(), 18)
      : Promise.resolve([]),
    hasScope(scopes, "today_turns") ? getRecentTurns(8) : Promise.resolve([]),
    hasScope(scopes, "proficiency")
      ? getProficiencySnapshot()
      : Promise.resolve({ calibrationHint: "" }),
  ]);

  if (hasScope(scopes, "profile")) {
    sections.push(
      `## Learner Profile\n${profileSliceForConversation(profileMd)}`,
    );
  }

  if (hasScope(scopes, "proficiency") && proficiency.calibrationHint) {
    sections.push(`## Difficulty Calibration\n${proficiency.calibrationHint}`);
  }

  if (hasScope(scopes, "weak_all")) {
    sections.push(`## Current Weak Items\n${formatWeakItems(weakList)}`);
  }

  if (hasScope(scopes, "weak_grammar")) {
    const grammar = allMastery.filter(
      (item) =>
        item.status !== "known" &&
        ["grammar", "error_pattern", "collocation"].includes(item.type),
    );
    sections.push(
      `## Grammar / Error Patterns\n${formatMasteryItems(grammar)}`,
    );
  }

  if (hasScope(scopes, "expression_gaps")) {
    const gaps = allMastery.filter(
      (item) => item.status !== "known" && item.type === "expression_gap",
    );
    sections.push(`## Expression Gaps\n${formatMasteryItems(gaps)}`);
  }

  if (hasScope(scopes, "due_review")) {
    const lines =
      dueReview.length === 0
        ? "(none)"
        : dueReview
            .map((item) => {
              const example =
                item.type === "expression_gap" && item.notes
                  ? item.notes
                  : item.example;
              return example
                ? `- [${item.type}] ${item.label} — ${oneLine(example, 140)}`
                : `- [${item.type}] ${item.label}`;
            })
            .join("\n");
    sections.push(`## Due For Review\n${lines}`);
  }

  if (hasScope(scopes, "today_turns")) {
    const turns = todayTurns.length > 0 ? todayTurns : recentTurns;
    sections.push(`## Today Or Recent Practice\n${formatTurns(turns)}`);
  }

  return sections.join("\n\n");
}
