import { describe, expect, it } from "vitest";
import { SentenceSegmenter } from "./segment";

describe("SentenceSegmenter", () => {
  it("英文按标点+空白切句,尾巴留到 flush", () => {
    const s = new SentenceSegmenter();
    expect(s.push("Hello there. How ")).toEqual(["Hello there."]);
    expect(s.push("Hello there. How are you? I'm")).toEqual(["How are you?"]);
    expect(s.flush("Hello there. How are you? I'm fine")).toEqual(["I'm fine"]);
  });

  it("CJK 句末无需空格也能切", () => {
    const s = new SentenceSegmenter();
    expect(s.push("你好。今天")).toEqual(["你好。"]);
    expect(s.push("你好。今天天气不错！出去")).toEqual(["今天天气不错！"]);
  });

  it("不会把小数切碎(后跟数字而非空白)", () => {
    const s = new SentenceSegmenter();
    expect(s.push("Pi is 3.14 and ")).toEqual([]);
    expect(s.flush("Pi is 3.14 and counting")).toEqual([
      "Pi is 3.14 and counting",
    ]);
  });

  it("缩写会被过度切分(可接受:分块仍按序完整播放)", () => {
    const s = new SentenceSegmenter();
    expect(s.push("I live in the U.S. now ")).toEqual(["I live in the U.S."]);
  });

  it("终止符落在末尾时先不切,等后续确认", () => {
    const s = new SentenceSegmenter();
    expect(s.push("Done.")).toEqual([]);
    expect(s.push("Done. Next")).toEqual(["Done."]);
  });

  it("收尾引号并入本句", () => {
    const s = new SentenceSegmenter();
    expect(s.push('He said "go." Then ')).toEqual(['He said "go."']);
  });

  it("无终止符的短回复整段在 flush 中返回", () => {
    const s = new SentenceSegmenter();
    expect(s.push("just a phrase")).toEqual([]);
    expect(s.flush("just a phrase")).toEqual(["just a phrase"]);
  });
});
