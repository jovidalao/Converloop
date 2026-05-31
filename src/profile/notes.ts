// 把一条用户笔记追加到档案的 ## My notes(用户主笔、AI 逐字保留、对话 agent 会读到)。
// 纯代码写 MD(用户动作触发,无 LLM)——记忆捕获的确定性路径。

import { loadConfig } from "../config";
import { ensureSections, parseProfile, serializeProfile } from "./parse";
import { readProfile, writeProfile } from "./profile";

// 纯函数(可测):在 My notes 末尾追加一条 bullet,标题结构由序列化保证。
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
