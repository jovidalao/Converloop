import { describe, expect, it } from "vitest";
import { profileSliceForConversation } from "./profile";

const md = `# Learner Profile · Chinese → English · B1 · updated 2026-05-31

## About me
- Frontend engineer

## AI preferences
### Global
- Use Australian English.

### Conversation
- Keep replies short.

### Correction

### Lessons

### Reading help

## Working on
- Articles a/an/the

## Expression gaps
- Politely declining a request

## My notes
<!-- User-written section — agents must never modify this -->
- Interview next Monday, practise self-introduction
`;

describe("profileSliceForConversation", () => {
  it("preserves the My notes section and its content (the conversation agent must see it)", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).toContain("## My notes");
    expect(slice).toContain("Interview next Monday");
  });

  it("strips placeholder HTML comments to avoid template noise in the prompt", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).not.toContain("<!--");
    expect(slice).not.toContain("User-written section");
  });

  it("strips the AI preferences section to avoid un-routed preferences repeating in profile context", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).not.toContain("## AI preferences");
    expect(slice).not.toContain("Use Australian English");
  });

  it("leaves no excessive blank lines", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).not.toMatch(/\n{3,}/);
  });
});
