// Append a user note to the ## My notes section of the profile (user-authored; AI preserves it verbatim; conversation agent reads it).
// Pure code writing MD (triggered by user action, no LLM) — the deterministic path for memory capture.

import { loadConfig } from "../config";
import { ensureSections, parseProfile, serializeProfile } from "./parse";
import { readProfile, writeProfile } from "./profile";

// Pure function (testable): append a bullet to the end of My notes; section structure is guaranteed by serialization.
export function appendNoteToMd(md: string, line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return md;
  const p = ensureSections(parseProfile(md));
  const bullet = `- ${trimmed}`;
  const sections = p.sections.map((s) => {
    if (s.title !== "My notes") return s;
    const existing = s.body.replace(/<!--[\s\S]*?-->/g, "").trim();
    return { ...s, body: existing ? `${existing}\n${bullet}` : bullet };
  });
  return serializeProfile({ ...p, sections });
}

export async function appendMyNote(line: string): Promise<void> {
  const md = await readProfile(loadConfig());
  await writeProfile(appendNoteToMd(md, line));
}
