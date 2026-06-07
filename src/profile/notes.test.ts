import { describe, expect, it } from "vitest";
import { appendNoteToMd } from "./notes";
import { parseProfile, SECTION_TITLES } from "./parse";

const base = `# Learner Profile · Chinese → English · B1 · updated 2026-05-31

## About me
- Frontend engineer

## Working on
- Articles a/an/the

## Comfortable with
- Simple past tense

## Avoids / rarely attempts
- Conditionals

## Interests
- Cooking

## Recently introduced
- "look forward to"

## Expression gaps
-

## My notes
<!-- User-written section — agents must never modify this -->
`;

function myNotesBody(md: string): string {
  return (
    parseProfile(md).sections.find((s) => s.title === "My notes")?.body ?? ""
  );
}

describe("appendNoteToMd", () => {
  it("empty My notes (placeholder comment only) → appended as sole bullet, comment stripped", () => {
    const out = appendNoteToMd(base, "Interview next Monday");
    expect(myNotesBody(out)).toBe("- Interview next Monday");
    expect(out).not.toContain("<!--");
  });

  it("existing content → new bullet appended at end", () => {
    const once = appendNoteToMd(base, "Interview next Monday");
    const twice = appendNoteToMd(once, "Prefer engineering examples");
    expect(myNotesBody(twice)).toBe(
      "- Interview next Monday\n- Prefer engineering examples",
    );
  });

  it("blank input → returned unchanged", () => {
    expect(appendNoteToMd(base, "   ")).toBe(base);
  });

  it("result still contains all required section titles (structure intact)", () => {
    const out = appendNoteToMd(base, "My name is Wei");
    for (const title of SECTION_TITLES) {
      expect(out).toContain(`## ${title}`);
    }
  });
});
