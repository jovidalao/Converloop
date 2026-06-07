import { describe, expect, it } from "vitest";
import {
  applyPreservedMyNotes,
  extractMyNotes,
  extractSectionBlock,
  sanityCheck,
} from "./sanity";

const oldMd = `# Learner Profile · Chinese → English · B1 · updated 2026-05-29

## About me
- Frontend engineer, recently started a new job; part-time postgraduate student

## AI preferences
### Global
- Use Australian English.

### Conversation

### Correction
- Ignore pure punctuation issues caused by voice input.

### Lessons

### Reading help

## Working on
- Articles a/an/the — especially unstable before abstract nouns
- Distinguishing simple past from present perfect
- Preposition collocations: depend on / good at

## Comfortable with
- Simple present, basic questions, imperatives
- Everyday vocabulary, greetings, ordering food and shopping

## Avoids / rarely attempts
- Conditionals (especially subjunctive mood)
- Passive voice, relative clauses

## Interests
- Cooking, hiking, frontend dev, cycling, photography, podcasts

## Recently introduced
- "look forward to", "pay attention to", "make sense", "by the way", "in the long run"

## Expression gaps
- Politely declining a request → I'd rather not take this on right now.

## My notes
My own notes: practise tenses more, review preposition collocations on weekends.
`;

const MY_NOTES =
  "My own notes: practise tenses more, review preposition collocations on weekends.\n";

function withSections(
  myNotes: string,
  working = "- Articles a/an/the",
): string {
  return `# Learner Profile · Chinese → English · B1 · updated 2026-05-30

## About me
- Frontend engineer

## AI preferences
### Global
- Use Australian English.

### Conversation

### Correction
- Ignore pure punctuation issues caused by voice input.

### Lessons

### Reading help

## Working on
${working}

## Comfortable with
- Simple past, present perfect

## Avoids / rarely attempts
- Conditionals

## Interests
- Cooking, hiking, frontend dev

## Recently introduced
- "pay attention to"

## Expression gaps
- Politely declining a request

## My notes
${myNotes}`;
}

describe("sanityCheck", () => {
  it("My notes preserved, all sections present → passes", () => {
    const newMd = withSections(MY_NOTES);
    expect(sanityCheck(oldMd, newMd).ok).toBe(true);
  });

  it("missing sections → rejected", () => {
    const broken =
      "# Learner Profile\n## Working on\n- x\n## My notes\nMy own notes: practise tenses.\n";
    const r = sanityCheck(oldMd, broken);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Missing required section");
  });

  it("My notes modified → rejected", () => {
    const tampered = withSections("agent secretly changed the user's notes\n");
    const r = sanityCheck(oldMd, tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("My notes");
  });

  it("AI preferences modified → rejected", () => {
    const tampered = withSections(MY_NOTES).replace(
      "Use Australian English",
      "Use American English",
    );
    const r = sanityCheck(oldMd, tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("AI preferences");
  });

  it("profile too long → rejected (agent did not control bullet count)", () => {
    const bloated = withSections(
      MY_NOTES,
      `${"- A weak point\n".repeat(1500)}`,
    );
    const r = sanityCheck(oldMd, bloated);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("too long");
  });

  it("length collapse → rejected (all sections present, My notes intact, but content lost)", () => {
    const collapsed = `## About me
${extractSectionBlock(oldMd, "AI preferences")}## Working on
## Comfortable with
## Avoids / rarely attempts
## Interests
## Recently introduced
## Expression gaps
## My notes
${MY_NOTES}`;
    const longOld = oldMd.replace(
      "- Cooking, hiking, frontend dev, cycling, photography, podcasts",
      `${"- A very long old interest entry\n".repeat(80)}`,
    );
    const r = sanityCheck(longOld, collapsed);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("collapse");
  });
});

describe("applyPreservedMyNotes", () => {
  it("restores LLM-modified My notes to the old version", () => {
    const llm = withSections("agent secretly changed it\n");
    const fixed = applyPreservedMyNotes(oldMd, llm);
    expect(sanityCheck(oldMd, fixed).ok).toBe(true);
    expect(extractMyNotes(fixed)).toBe(extractMyNotes(oldMd));
  });

  it("restores My notes when the LLM omits it", () => {
    const without = `# Learner Profile

## About me
- Frontend engineer

## Working on
- x

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
`;
    const fixed = applyPreservedMyNotes(oldMd, without);
    expect(fixed).toContain("## My notes");
    expect(sanityCheck(oldMd, fixed).ok).toBe(true);
  });
});

describe("extractMyNotes", () => {
  it("extracts the My notes block", () => {
    expect(extractMyNotes(oldMd)).toContain("## My notes");
    expect(extractMyNotes(oldMd)).toContain("practise tenses");
  });
});
