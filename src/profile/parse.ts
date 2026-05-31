// learner-profile.md 的结构化解析 / 序列化(纯逻辑,可测)。
// 用于结构化档案编辑器:按段编辑,标题由序列化保证,用户改不坏结构。
// 段标题与 sanity.ts 的 REQUIRED_SECTIONS 一致。

import { REQUIRED_SECTIONS } from "./sanity";

// 规范段顺序(不含 "## " 前缀),序列化时按此顺序输出。
export const SECTION_TITLES = REQUIRED_SECTIONS.map((h) =>
  h.replace(/^##\s+/, ""),
);

export interface ProfileSection {
  title: string; // 不含 "## ",如 "About me"
  body: string; // 标题行之后到下一个标题之间的正文(去掉首尾空行)
}

export interface ParsedProfile {
  header: string; // 第一个 "## " 之前的内容(通常是 "# Learner Profile …" 行)
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

// 保证 7 个规范段都在、且按规范顺序;缺的补空段,未知段保留在末尾。
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
