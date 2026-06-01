import { describe, expect, it } from "vitest";
import { profileSliceForConversation } from "./profile";

const md = `# Learner Profile · Chinese → English · B1 · updated 2026-05-31

## About me
- 前端工程师

## AI preferences
### Global
- 用澳大利亚英语。

### Conversation
- 回复短一点。

### Correction

### Lessons

### Reading help

## Working on
- 冠词 a/an/the

## My notes
<!-- 用户手写区,agent 永不改动 -->
- 下周一有面试,多练自我介绍
`;

describe("profileSliceForConversation", () => {
  it("保留 My notes 段及其内容(对话 agent 要读到)", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).toContain("## My notes");
    expect(slice).toContain("下周一有面试");
  });

  it("剥掉占位 HTML 注释,避免模板噪声进 prompt", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).not.toContain("<!--");
    expect(slice).not.toContain("用户手写区");
  });

  it("剥掉 AI preferences 段,避免未分流的偏好重复进档案上下文", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).not.toContain("## AI preferences");
    expect(slice).not.toContain("用澳大利亚英语");
  });

  it("不留多余空行", () => {
    const slice = profileSliceForConversation(md);
    expect(slice).not.toMatch(/\n{3,}/);
  });
});
