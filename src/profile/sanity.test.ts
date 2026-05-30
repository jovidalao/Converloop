import { describe, it, expect } from "vitest";
import { sanityCheck, extractMyNotes, applyPreservedMyNotes } from "./sanity";

const oldMd = `# Learner Profile · Chinese → English · B1 · updated 2026-05-29

## Working on
- 冠词 a/an/the —— 抽象名词前尤其不稳
- 一般过去时与现在完成时的区分
- 介词搭配:depend on / good at

## Comfortable with
- 一般现在时、基本疑问句、祈使句
- 日常词汇、问候与寒暄、点餐与购物表达

## Avoids / rarely attempts
- 条件句(尤其是虚拟语气)
- 被动语态、定语从句

## Interests
- 做饭、徒步、前端开发、骑行、摄影、播客

## Recently introduced
- "look forward to", "pay attention to", "make sense", "by the way", "in the long run"

## My notes
我自己记的:多练时态,周末复习介词搭配。
`;

const MY_NOTES = "我自己记的:多练时态,周末复习介词搭配。\n";

function withSections(myNotes: string, working = "- 冠词 a/an/the"): string {
  return `# Learner Profile · Chinese → English · B1 · updated 2026-05-30

## Working on
${working}

## Comfortable with
- 一般过去时、现在完成时

## Avoids / rarely attempts
- 条件句

## Interests
- 做饭、徒步、前端

## Recently introduced
- "pay attention to"

## My notes
${myNotes}`;
}

describe("sanityCheck", () => {
  it("保留 My notes、含全部段落 → 通过", () => {
    const newMd = withSections(MY_NOTES);
    expect(sanityCheck(oldMd, newMd).ok).toBe(true);
  });

  it("缺段落 → 拒绝", () => {
    const broken = "# Learner Profile\n## Working on\n- x\n## My notes\n我自己记的:多练时态。\n";
    const r = sanityCheck(oldMd, broken);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("缺少必需段落");
  });

  it("改了 My notes → 拒绝", () => {
    const tampered = withSections("agent 偷偷改了用户的笔记\n");
    const r = sanityCheck(oldMd, tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("My notes");
  });

  it("长度坍缩 → 拒绝(段落全、My notes 原样,但内容被吃掉)", () => {
    const collapsed = `## Working on
## Comfortable with
## Avoids / rarely attempts
## Interests
## Recently introduced
## My notes
${MY_NOTES}`;
    const r = sanityCheck(oldMd, collapsed);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("坍缩");
  });
});

describe("applyPreservedMyNotes", () => {
  it("把 LLM 改过的 My notes 贴回旧版", () => {
    const llm = withSections("agent 偷偷改了\n");
    const fixed = applyPreservedMyNotes(oldMd, llm);
    expect(sanityCheck(oldMd, fixed).ok).toBe(true);
    expect(extractMyNotes(fixed)).toBe(extractMyNotes(oldMd));
  });

  it("LLM 漏掉 My notes 时补上", () => {
    const without = `# Learner Profile

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
`;
    const fixed = applyPreservedMyNotes(oldMd, without);
    expect(fixed).toContain("## My notes");
    expect(sanityCheck(oldMd, fixed).ok).toBe(true);
  });
});

describe("extractMyNotes", () => {
  it("抽出 My notes 块", () => {
    expect(extractMyNotes(oldMd)).toContain("## My notes");
    expect(extractMyNotes(oldMd)).toContain("多练时态");
  });
});
