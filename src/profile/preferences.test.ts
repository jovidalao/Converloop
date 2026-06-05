import { describe, expect, it } from "vitest";
import {
  appendClassifiedPreferences,
  correctionPreferenceFlags,
  formatExperiencePreferences,
  preferencesFromProfile,
  updateProfilePreference,
} from "./preferences";

const md = `# Learner Profile · Chinese → English · B1 · updated 2026-06-01

## About me
- 前端工程师

## AI preferences
### Global
- Use Australian English.

### Conversation
- Keep replies concise.

### Correction
- 我经常用语音输入,请忽略纯大小写和标点问题。

### Lessons
- Drill one pattern at a time.

### Reading help
- 翻译更口语化。

## Working on
- 冠词

## Comfortable with
-

## Avoids / rarely attempts
-

## Interests
-

## Recently introduced
-

## Expression gaps
-

## My notes
- 下周一有面试
`;

describe("profile preferences", () => {
  it("按模块提取并格式化偏好", () => {
    const prefs = preferencesFromProfile(md);

    expect(prefs.global).toContain("Australian English");
    expect(prefs.tutor).toContain("语音输入");
    expect(formatExperiencePreferences(md, "conversation")).toContain(
      "Keep replies concise",
    );
    expect(formatExperiencePreferences(md, "conversation")).not.toContain(
      "Drill one pattern",
    );
  });

  it("更新某个模块后仍写回档案段", () => {
    const next = updateProfilePreference(md, "reading", "- 多解释习语语境");

    expect(next).toContain("## AI preferences");
    expect(next).toContain("### Reading help");
    expect(next).toContain("- 多解释习语语境");
    expect(next).toContain("## My notes");
  });

  it("把 AI 归类结果追加到对应模块", () => {
    const next = appendClassifiedPreferences(md, [
      { scope: "conversation", instruction: "Use a casual tone." },
      { scope: "tutor", instruction: "Only flag errors that affect meaning." },
    ]);

    const prefs = preferencesFromProfile(next);
    expect(prefs.conversation).toContain("Use a casual tone");
    expect(prefs.tutor).toContain("Only flag errors");
  });

  it("从文本偏好推断确定性批改过滤选项", () => {
    expect(correctionPreferenceFlags(md)).toEqual({
      ignoreCapitalizationIssues: true,
      ignorePunctuationIssues: true,
    });
  });
});
