import { describe, expect, it } from "vitest";
import {
  ensureSections,
  parseProfile,
  SECTION_TITLES,
  serializeProfile,
} from "./parse";
import { sanityCheck } from "./sanity";

const md = `# Learner Profile · Chinese → English · B1 · updated 2026-05-31

## About me
- Frontend engineer

## AI preferences
### Global

### Conversation

### Correction

### Lessons

### Reading help

## Working on
- Articles a/an/the
- Present perfect tense

## Comfortable with
- Simple past tense

## Avoids / rarely attempts
- Conditionals

## Interests
- Cooking, hiking

## Recently introduced
- "look forward to"

## Expression gaps
- Politely declining a request

## My notes
- Interview next Monday
`;

describe("parseProfile", () => {
  it("splits out header and canonical sections", () => {
    const p = parseProfile(md);
    expect(p.header).toContain("# Learner Profile");
    expect(p.sections.map((s) => s.title)).toEqual(SECTION_TITLES);
  });

  it("body placed in correct section, leading/trailing blank lines stripped", () => {
    const p = parseProfile(md);
    const working = p.sections.find((s) => s.title === "Working on");
    expect(working?.body).toBe("- Articles a/an/the\n- Present perfect tense");
  });
});

describe("serializeProfile round-trip", () => {
  it("parse → serialize → re-parse yields identical section titles and bodies", () => {
    const p = parseProfile(md);
    const out = serializeProfile(p);
    const again = parseProfile(out);
    expect(again.sections).toEqual(p.sections);
  });

  it("serialized output contains all required section titles and passes sanityCheck", () => {
    const out = serializeProfile(parseProfile(md));
    expect(sanityCheck(md, out).ok).toBe(true);
  });

  it("editing a section body still preserves all titles (structure not broken)", () => {
    const p = parseProfile(md);
    const working = p.sections.find((s) => s.title === "Working on");
    if (working) working.body = "Some arbitrary text\nwithout bullets";
    const out = serializeProfile(p);
    for (const title of SECTION_TITLES) {
      expect(out).toContain(`## ${title}`);
    }
  });
});

describe("ensureSections", () => {
  it("missing sections are added empty, canonical order is applied, unknown sections stay at end", () => {
    const partial = parseProfile(
      "# H\n\n## Working on\n- x\n\n## Custom section\n- y\n",
    );
    const fixed = ensureSections(partial);
    const titles = fixed.sections.map((s) => s.title);
    expect(titles.slice(0, SECTION_TITLES.length)).toEqual(SECTION_TITLES);
    expect(titles).toContain("Custom section");
  });
});
