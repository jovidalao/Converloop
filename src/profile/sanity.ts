// Lightweight sanity check for learner-profile.md (pure logic, testable).
// Any failing check → discard the new result and keep the old MD. See docs/profile-maintainer-agent.md#output-handling.

export const REQUIRED_SECTIONS = [
  "## About me",
  "## AI preferences",
  "## Working on",
  "## Comfortable with",
  "## Avoids / rarely attempts",
  "## Interests",
  "## Recently introduced",
  "## Expression gaps",
  "## My notes",
] as const;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSectionBlock(md: string, title: string): string {
  const match = new RegExp(`^##\\s+${escapeRegex(title)}\\s*$`, "m").exec(md);
  if (!match) return "";
  const start = match.index;
  const rest = md.slice(start + match[0].length);
  const next = /^##\s+.+?\s*$/m.exec(rest);
  return next
    ? md.slice(start, start + match[0].length + next.index)
    : md.slice(start);
}

// Verbatim text from "## My notes" to the end of the file (including the title line). User-authored section; agents must preserve it verbatim.
export function extractMyNotes(md: string): string {
  return extractSectionBlock(md, "My notes");
}

function replaceOrInsertSection(
  md: string,
  title: string,
  block: string,
  beforeTitle?: string,
): string {
  const current = extractSectionBlock(md, title);
  if (current) return md.replace(current, block);
  if (beforeTitle) {
    const before = extractSectionBlock(md, beforeTitle);
    if (before) return md.replace(before, `${block}${before}`);
  }
  return `${md.trimEnd()}\n\n${block}`;
}

/** LLMs often silently adjust user-customized sections; before writing, forcibly restore the old blocks to prevent the full update from being rejected by sanity. */
export function applyPreservedUserSections(
  oldMd: string,
  newMd: string,
): string {
  let next = newMd;
  const preferences = extractSectionBlock(oldMd, "AI preferences");
  if (preferences) {
    next = replaceOrInsertSection(
      next,
      "AI preferences",
      preferences,
      "Working on",
    );
  }
  const notes = extractMyNotes(oldMd);
  if (notes) {
    next = replaceOrInsertSection(next, "My notes", notes);
  }
  return next;
}

/** @deprecated Use applyPreservedUserSections. */
export function applyPreservedMyNotes(oldMd: string, newMd: string): string {
  return applyPreservedUserSections(oldMd, newMd);
}

export interface SanityResult {
  ok: boolean;
  reason?: string;
}

// The full profile goes into the conversation prompt every turn. If the maintainer agent ignores the "≤6 bullets per section" rule and inflates it,
// that directly raises latency and cost on the hot path. A hard length cap is the backstop: a normal 7-section profile is well below this limit;
// hitting the cap means the agent ran wild — discard the result and keep the old profile.
const MAX_PROFILE_CHARS = 8000;

export function sanityCheck(oldMd: string, newMd: string): SanityResult {
  for (const header of REQUIRED_SECTIONS) {
    if (!newMd.includes(header)) {
      return { ok: false, reason: `Missing required section: ${header}` };
    }
  }
  const oldPreferences = extractSectionBlock(oldMd, "AI preferences");
  if (
    oldPreferences &&
    extractSectionBlock(newMd, "AI preferences") !== oldPreferences
  ) {
    return {
      ok: false,
      reason: "## AI preferences was modified (must be preserved verbatim)",
    };
  }
  if (
    extractMyNotes(oldMd) &&
    extractMyNotes(newMd) !== extractMyNotes(oldMd)
  ) {
    return {
      ok: false,
      reason: "## My notes was modified (must be preserved verbatim)",
    };
  }
  if (oldMd.length > 0 && newMd.length < oldMd.length * 0.3) {
    return {
      ok: false,
      reason: "Abnormal length collapse (content may have been lost)",
    };
  }
  if (newMd.length > MAX_PROFILE_CHARS) {
    return {
      ok: false,
      reason: `Profile too long (${newMd.length} chars, limit ${MAX_PROFILE_CHARS}) — agent may not have controlled bullet count`,
    };
  }
  return { ok: true };
}
