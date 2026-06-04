import { describe, expect, it } from "vitest";
import {
  matchSlashCommands,
  parseSlashInput,
  slashMenuToken,
} from "./commands";

describe("parseSlashInput", () => {
  it("解析 message 命令并取出参数", () => {
    const p = parseSlashInput("/btw what does 'gist' mean?");
    expect(p?.command.name).toBe("btw");
    expect(p?.command.kind).toBe("message");
    expect(p?.rest).toBe("what does 'gist' mean?");
  });

  it("无参数的命令 rest 为空串", () => {
    expect(parseSlashInput("/btw")?.rest).toBe("");
    expect(parseSlashInput("/btw   ")?.rest).toBe("");
  });

  it("解析 action 命令", () => {
    const p = parseSlashInput("/harder");
    expect(p?.command.kind).toBe("action");
    expect(p?.command.actionId).toBe("builtin:action:harder");
  });

  it("命令名大小写不敏感", () => {
    expect(parseSlashInput("/BTW hi")?.command.name).toBe("btw");
  });

  it("带连字符的命令名", () => {
    expect(parseSlashInput("/next-day")?.command.name).toBe("next-day");
  });

  it("未知命令返回 null(当普通文本)", () => {
    expect(parseSlashInput("/unknown")).toBeNull();
    expect(parseSlashInput("/btwx")).toBeNull();
  });

  it("非行首斜杠 / 普通文本 / 裸斜杠返回 null", () => {
    expect(parseSlashInput("hello /btw")).toBeNull();
    expect(parseSlashInput("  /btw")).toBeNull();
    expect(parseSlashInput("just text")).toBeNull();
    expect(parseSlashInput("/")).toBeNull();
  });
});

describe("slashMenuToken", () => {
  it("裸斜杠 → 空 token(展示全部)", () => {
    expect(slashMenuToken("/")).toBe("");
  });

  it("正在输入命令词 → 返回该词", () => {
    expect(slashMenuToken("/ha")).toBe("ha");
    expect(slashMenuToken("/next-day")).toBe("next-day");
  });

  it("命令词后出现空格(进入参数态)→ null", () => {
    expect(slashMenuToken("/btw ")).toBeNull();
    expect(slashMenuToken("/btw hello")).toBeNull();
  });

  it("不以斜杠开头 → null", () => {
    expect(slashMenuToken("hello")).toBeNull();
    expect(slashMenuToken("")).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  it("空 token 返回全部可用命令(canDerive)", () => {
    const r = matchSlashCommands("", { canDerive: true });
    expect(r.map((c) => c.name)).toEqual(
      expect.arrayContaining(["btw", "help", "harder", "swap", "next-day"]),
    );
  });

  it("不能衍生时隐藏 action 类命令,仍保留 btw/help", () => {
    const r = matchSlashCommands("", { canDerive: false }).map((c) => c.name);
    expect(r).toContain("btw");
    expect(r).toContain("help");
    expect(r).not.toContain("harder");
    expect(r).not.toContain("swap");
  });

  it("按前缀过滤", () => {
    const r = matchSlashCommands("ha", { canDerive: true });
    expect(r.map((c) => c.name)).toEqual(["harder"]);
  });

  it("startsWith 命中排在 includes 命中前面", () => {
    // "e" 同时出现在 "easier"(前缀)和 "harder"/"help"/"next-day"(包含)里。
    const r = matchSlashCommands("e", { canDerive: true });
    expect(r[0]?.name).toBe("easier");
  });
});
