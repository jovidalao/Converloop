// Structured parsing / serialization of learner-profile.md (pure logic, testable).
// Used by the structured profile editor: edit by section; section titles are enforced by serialization so users cannot break the structure.
// Section titles match REQUIRED_SECTIONS in sanity.ts.

import { REQUIRED_SECTIONS } from "./sanity";

// Canonical section order (without the "## " prefix); sections are output in this order during serialization.
export const SECTION_TITLES = REQUIRED_SECTIONS.map((h) =>
  h.replace(/^##\s+/, ""),
);

export interface ProfileSection {
  title: string; // without "## ", e.g. "About me"
  body: string; // body text between this title line and the next heading (leading/trailing blank lines stripped)
}

export interface ParsedProfile {
  header: string; // content before the first "## " (typically the "# Learner Profile …" line)
  sections: ProfileSection[];
}

const SECTION_RE = /^##\s+(.+?)\s*$/;

export function parseProfile(md: string): ParsedProfile {
  const lines = md.split("\n");
  const headerLines: string[] = [];
  const sections: ProfileSection[] = [];
  let current: { title: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(SECTION_RE);
    if (m) {
      if (current)
        sections.push({
          title: current.title,
          body: trimBlank(current.bodyLines),
        });
      current = { title: m[1], bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      headerLines.push(line);
    }
  }
  if (current)
    sections.push({ title: current.title, body: trimBlank(current.bodyLines) });

  return { header: headerLines.join("\n").trim(), sections };
}

function trimBlank(lines: string[]): string {
  return lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

// Ensure all canonical sections are present in canonical order; missing sections are filled with an empty body, unknown sections are appended at the end.
export function ensureSections(p: ParsedProfile): ParsedProfile {
  const byTitle = new Map(p.sections.map((s) => [s.title, s]));
  const ordered: ProfileSection[] = SECTION_TITLES.map(
    (title) => byTitle.get(title) ?? { title, body: "" },
  );
  const extra = p.sections.filter((s) => !SECTION_TITLES.includes(s.title));
  return { header: p.header, sections: [...ordered, ...extra] };
}

export function serializeProfile(p: ParsedProfile): string {
  const head = p.header.trim();
  const body = p.sections
    .map((s) => `## ${s.title}\n${s.body.trim() ? `${s.body.trim()}\n` : ""}`)
    .join("\n");
  return `${head}\n\n${body}`
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}
