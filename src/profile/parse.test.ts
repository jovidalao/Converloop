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
- 前端工程师

## AI preferences
### Global

### Conversation

### Correction

### Lessons

### Reading help

## Working on
- 冠词 a/an/the
- 现在完成时

## Comfortable with
- 一般过去时

## Avoids / rarely attempts
- 条件句

## Interests
- 做饭、徒步

## Recently introduced
- "look forward to"

## My notes
- 下周一有面试
`;

describe("parseProfile", () => {
  it("拆出 header 和规范段", () => {
    const p = parseProfile(md);
    expect(p.header).toContain("# Learner Profile");
    expect(p.sections.map((s) => s.title)).toEqual(SECTION_TITLES);
  });

  it("正文按段归位、去首尾空行", () => {
    const p = parseProfile(md);
    const working = p.sections.find((s) => s.title === "Working on");
    expect(working?.body).toBe("- 冠词 a/an/the\n- 现在完成时");
  });
});

describe("serializeProfile round-trip", () => {
  it("解析→序列化→再解析,段标题与正文一致", () => {
    const p = parseProfile(md);
    const out = serializeProfile(p);
    const again = parseProfile(out);
    expect(again.sections).toEqual(p.sections);
  });

  it("序列化结果含全部必需段标题,sanityCheck 通过", () => {
    const out = serializeProfile(parseProfile(md));
    expect(sanityCheck(md, out).ok).toBe(true);
  });

  it("改某段正文后仍含全部标题(改不坏结构)", () => {
    const p = parseProfile(md);
    const working = p.sections.find((s) => s.title === "Working on");
    if (working) working.body = "随便写点东西\n甚至没有 bullet";
    const out = serializeProfile(p);
    for (const title of SECTION_TITLES) {
      expect(out).toContain(`## ${title}`);
    }
  });
});

describe("ensureSections", () => {
  it("缺段补空、按规范顺序、未知段留末尾", () => {
    const partial = parseProfile(
      "# H\n\n## Working on\n- x\n\n## 自定义\n- y\n",
    );
    const fixed = ensureSections(partial);
    const titles = fixed.sections.map((s) => s.title);
    expect(titles.slice(0, SECTION_TITLES.length)).toEqual(SECTION_TITLES);
    expect(titles).toContain("自定义");
  });
});
