// learner-profile.md 的轻量 sanity check(纯逻辑,可测)。
// 任何一项不过 → 丢弃本次结果、保留旧 MD。见 docs/profile-maintainer-agent.md#输出处理。

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

// "## My notes" 到文末的原文(含标题行)。用户手写区,agent 必须逐字保留。
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

/** LLM 常会微调用户自定义段;写入前强制贴回旧 block,避免整份更新被 sanity 拒绝。 */
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

// 档案每轮整份进对话 prompt。维护 agent 若无视「每段 ≤6 bullet」把它撑大,会直接
// 推高热路径的延迟和成本。设一个总长上限兜底:正常 7 段档案远低于此,触顶 = agent
// 跑飞,丢弃本次结果、保留旧档案。
const MAX_PROFILE_CHARS = 8000;

export function sanityCheck(oldMd: string, newMd: string): SanityResult {
  for (const header of REQUIRED_SECTIONS) {
    if (!newMd.includes(header)) {
      return { ok: false, reason: `缺少必需段落:${header}` };
    }
  }
  const oldPreferences = extractSectionBlock(oldMd, "AI preferences");
  if (
    oldPreferences &&
    extractSectionBlock(newMd, "AI preferences") !== oldPreferences
  ) {
    return { ok: false, reason: "## AI preferences 被改动(必须逐字保留)" };
  }
  if (
    extractMyNotes(oldMd) &&
    extractMyNotes(newMd) !== extractMyNotes(oldMd)
  ) {
    return { ok: false, reason: "## My notes 被改动(必须逐字保留)" };
  }
  if (oldMd.length > 0 && newMd.length < oldMd.length * 0.3) {
    return { ok: false, reason: "长度异常坍缩(疑似内容被吃掉)" };
  }
  if (newMd.length > MAX_PROFILE_CHARS) {
    return {
      ok: false,
      reason: `档案过长(${newMd.length} 字符,上限 ${MAX_PROFILE_CHARS}),疑似 agent 未控制 bullet 数`,
    };
  }
  return { ok: true };
}
