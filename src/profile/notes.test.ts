import { describe, expect, it } from "vitest";
import { appendNoteToMd } from "./notes";
import { parseProfile, SECTION_TITLES } from "./parse";

const base = `# Learner Profile · Chinese → English · B1 · updated 2026-05-31

## About me
- 前端工程师

## Working on
- 冠词 a/an/the

## Comfortable with
- 一般过去时

## Avoids / rarely attempts
- 条件句

## Interests
- 做饭

## Recently introduced
- "look forward to"

## Expression gaps
-

## My notes
<!-- 用户手写区,agent 永不改动 -->
`;

function myNotesBody(md: string): string {
  return (
    parseProfile(md).sections.find((s) => s.title === "My notes")?.body ?? ""
  );
}

describe("appendNoteToMd", () => {
  it("空 My notes(仅占位注释)→ 追加为唯一 bullet,注释被清掉", () => {
    const out = appendNoteToMd(base, "下周一有面试");
    expect(myNotesBody(out)).toBe("- 下周一有面试");
    expect(out).not.toContain("<!--");
  });

  it("已有内容 → 追加新 bullet 到末尾", () => {
    const once = appendNoteToMd(base, "下周一有面试");
    const twice = appendNoteToMd(once, "喜欢用工程师的例子");
    expect(myNotesBody(twice)).toBe("- 下周一有面试\n- 喜欢用工程师的例子");
  });

  it("空白输入 → 原样返回", () => {
    expect(appendNoteToMd(base, "   ")).toBe(base);
  });

  it("结果仍含全部必需段标题(结构不破)", () => {
    const out = appendNoteToMd(base, "记住我叫 Wei");
    for (const title of SECTION_TITLES) {
      expect(out).toContain(`## ${title}`);
    }
  });
});
