import { describe, expect, it } from "vitest";
import {
  projectCompletedLessonIds,
  projectLessonIds,
  projectNextLessonId,
} from "./learning-projects";
import type { LearningProject } from "./schema";

function project(lessonIds: string[], completedIds: string[]): LearningProject {
  return {
    id: "p1",
    title: "t",
    goal: "g",
    status: "active",
    planMd: "",
    notesMd: "",
    sourcePrompt: null,
    taskPlanJson: null,
    lessonAgentIdsJson: JSON.stringify(lessonIds),
    completedLessonIdsJson: JSON.stringify(completedIds),
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("learning project progress", () => {
  it("derives the next lesson as the first not-yet-done one", () => {
    const p = project(["a", "b", "c"], ["a"]);
    expect(projectLessonIds(p)).toEqual(["a", "b", "c"]);
    expect(projectCompletedLessonIds(p)).toEqual(["a"]);
    expect(projectNextLessonId(p)).toBe("b");
  });

  it("returns null when all lessons are done or none are linked", () => {
    expect(projectNextLessonId(project(["a"], ["a"]))).toBeNull();
    expect(projectNextLessonId(project([], []))).toBeNull();
  });

  it("treats corrupt id lists as empty", () => {
    const p = {
      ...project(["a"], []),
      lessonAgentIdsJson: "{not json",
    };
    expect(projectLessonIds(p)).toEqual([]);
    expect(projectNextLessonId(p)).toBeNull();
  });
});
