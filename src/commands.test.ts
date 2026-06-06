import { describe, expect, it } from "vitest";
import {
  matchSlashCommands,
  parseSlashInput,
  slashMenuToken,
} from "./commands";

describe("parseSlashInput", () => {
  it("parses a message command and extracts arguments", () => {
    const p = parseSlashInput("/btw what does 'gist' mean?");
    expect(p?.command.name).toBe("btw");
    expect(p?.command.kind).toBe("message");
    expect(p?.rest).toBe("what does 'gist' mean?");
  });

  it("command with no arguments has empty rest", () => {
    expect(parseSlashInput("/btw")?.rest).toBe("");
    expect(parseSlashInput("/btw   ")?.rest).toBe("");
  });

  it("parses an action command", () => {
    const p = parseSlashInput("/harder");
    expect(p?.command.kind).toBe("action");
    expect(p?.command.actionId).toBe("builtin:action:harder");
  });

  it("command name is case-insensitive", () => {
    expect(parseSlashInput("/BTW hi")?.command.name).toBe("btw");
  });

  it("command name with hyphen", () => {
    expect(parseSlashInput("/next-day")?.command.name).toBe("next-day");
  });

  it("unknown command returns null (treated as plain text)", () => {
    expect(parseSlashInput("/unknown")).toBeNull();
    expect(parseSlashInput("/btwx")).toBeNull();
  });

  it("non-leading slash / plain text / bare slash returns null", () => {
    expect(parseSlashInput("hello /btw")).toBeNull();
    expect(parseSlashInput("  /btw")).toBeNull();
    expect(parseSlashInput("just text")).toBeNull();
    expect(parseSlashInput("/")).toBeNull();
  });
});

describe("slashMenuToken", () => {
  it("bare slash → empty token (show all)", () => {
    expect(slashMenuToken("/")).toBe("");
  });

  it("typing a command word → returns that word", () => {
    expect(slashMenuToken("/ha")).toBe("ha");
    expect(slashMenuToken("/next-day")).toBe("next-day");
  });

  it("space after command word (entering argument mode) → null", () => {
    expect(slashMenuToken("/btw ")).toBeNull();
    expect(slashMenuToken("/btw hello")).toBeNull();
  });

  it("does not start with slash → null", () => {
    expect(slashMenuToken("hello")).toBeNull();
    expect(slashMenuToken("")).toBeNull();
  });
});

describe("matchSlashCommands", () => {
  it("empty token returns all available commands (canDerive)", () => {
    const r = matchSlashCommands("", { canDerive: true });
    expect(r.map((c) => c.name)).toEqual(
      expect.arrayContaining(["btw", "help", "harder", "swap", "next-day"]),
    );
  });

  it("hides action commands when cannot derive, keeps btw/help", () => {
    const r = matchSlashCommands("", { canDerive: false }).map((c) => c.name);
    expect(r).toContain("btw");
    expect(r).toContain("help");
    expect(r).not.toContain("harder");
    expect(r).not.toContain("swap");
  });

  it("filters by prefix", () => {
    const r = matchSlashCommands("ha", { canDerive: true });
    expect(r.map((c) => c.name)).toEqual(["harder"]);
  });

  it("startsWith matches ranked before includes matches", () => {
    // "e" appears in "easier" (prefix match) and "harder"/"help"/"next-day" (substring match).
    const r = matchSlashCommands("e", { canDerive: true });
    expect(r[0]?.name).toBe("easier");
  });
});
