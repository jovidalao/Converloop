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
- Frontend engineer

## AI preferences
### Global
- Use Australian English.

### Conversation
- Keep replies concise.

### Correction
- I often use voice input; please ignore pure capitalization and punctuation issues.

### Lessons
- Drill one pattern at a time.

### Reading help
- Keep translations more colloquial.

## Working on
- Articles

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
- Interview next Monday
`;

describe("profile preferences", () => {
  it("extracts and formats preferences by module", () => {
    const prefs = preferencesFromProfile(md);

    expect(prefs.global).toContain("Australian English");
    expect(prefs.tutor).toContain("voice input");
    expect(formatExperiencePreferences(md, "conversation")).toContain(
      "Keep replies concise",
    );
    expect(formatExperiencePreferences(md, "conversation")).not.toContain(
      "Drill one pattern",
    );
  });

  it("updating a module writes back to the profile section", () => {
    const next = updateProfilePreference(md, "reading", "- Explain idioms in context more.");

    expect(next).toContain("## AI preferences");
    expect(next).toContain("### Reading help");
    expect(next).toContain("- Explain idioms in context more.");
    expect(next).toContain("## My notes");
  });

  it("appends AI-classified results to the corresponding module", () => {
    const next = appendClassifiedPreferences(md, [
      { scope: "conversation", instruction: "Use a casual tone." },
      { scope: "tutor", instruction: "Only flag errors that affect meaning." },
    ]);

    const prefs = preferencesFromProfile(next);
    expect(prefs.conversation).toContain("Use a casual tone");
    expect(prefs.tutor).toContain("Only flag errors");
  });

  it("infers deterministic correction filter flags from text preferences", () => {
    expect(correctionPreferenceFlags(md)).toEqual({
      ignoreCapitalizationIssues: true,
      ignorePunctuationIssues: true,
    });
  });
});
