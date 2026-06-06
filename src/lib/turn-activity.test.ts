import { describe, expect, it } from "vitest";
import type { TutorAnalysis } from "../agents/schema";
import type { ChatTurn } from "../db/turns";
import { deriveTurnActivities } from "./turn-activity";

function turn(partial: Partial<ChatTurn>): ChatTurn {
  return { id: "t1", userText: "hello", analysis: null, ...partial };
}

const cleanAnalysis: TutorAnalysis = {
  is_correct: true,
  corrected: "hello",
  natural: "hello",
  issues: [],
  mastery_updates: [],
  expression_gap: null,
};

describe("deriveTurnActivities", () => {
  it("off-record (/btw) turns have no activities", () => {
    expect(
      deriveTurnActivities(
        turn({ excludeFromContext: true, analysis: cleanAnalysis }),
      ),
    ).toEqual([]);
  });

  it("learning-mode-style turn (no analysis, not pending) has no activities", () => {
    expect(deriveTurnActivities(turn({ partnerText: "Hi there" }))).toEqual([]);
  });

  it("pending analysis surfaces a Grading tutor activity", () => {
    const acts = deriveTurnActivities(turn({ analysisPending: true }));
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ kind: "tutor", status: "pending" });
  });

  it("clean analysis → accurate expression, no memory", () => {
    const acts = deriveTurnActivities(turn({ analysis: cleanAnalysis }));
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ kind: "tutor", status: "ok" });
  });

  it("issues produce a corrective tutor activity + a memory count", () => {
    const analysis: TutorAnalysis = {
      ...cleanAnalysis,
      is_correct: false,
      corrected: "I have been",
      issues: [
        {
          category: "grammar",
          span_original: "I has",
          span_corrected: "I have",
          explanation: "subject-verb agreement",
          severity: "moderate",
          mastery_key: "grammar:subject_verb_agreement",
          mastery_label: "Subject-verb agreement",
          mastery_type: "grammar",
        },
      ],
    };
    const acts = deriveTurnActivities(
      turn({ userText: "I has been", analysis }),
    );
    expect(acts.map((a) => a.kind)).toEqual(["tutor", "memory"]);
    expect(acts[0]).toMatchObject({ status: "info", count: 1 });
    expect(acts[1]).toMatchObject({
      kind: "memory",
      count: 1,
      label: "Recorded 1 item",
    });
  });

  it("expression gap → Expression gap tutor + a gap memory signal", () => {
    const analysis: TutorAnalysis = {
      ...cleanAnalysis,
      corrected: "",
      natural: "",
      expression_gap: {
        mastery_key: "gap:decline_politely",
        mastery_label: "Politely declining",
        original: "I don't know how to decline politely",
        target_expression: "I'd rather not, if that's okay.",
        explanation: "Use 'I'd rather not' to soften a refusal",
        key_items: [],
      },
    };
    const acts = deriveTurnActivities(turn({ analysis }));
    expect(acts[0]).toMatchObject({ kind: "tutor", label: "Expression gap" });
    expect(acts.some((a) => a.kind === "memory")).toBe(true);
  });
});
