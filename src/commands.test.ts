import { afterEach, describe, expect, it } from "vitest";
import {
  matchSlashCommands,
  parseSlashInput,
  resolvePromptMacros,
  slashMenuToken,
} from "./commands";
import {
  clearPromptMacroOverride,
  deleteCustomPromptMacro,
  setPromptMacroOverride,
  upsertCustomPromptMacro,
} from "./runtime/prompt-macro-store";

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

  it("parses a prompt command and builds the expanded prompt from args", () => {
    const p = parseSlashInput("/topic the CAP theorem");
    expect(p?.command.kind).toBe("prompt");
    expect(p?.rest).toBe("the CAP theorem");
    expect(p?.command.buildPrompt?.(p.rest)).toContain("the CAP theorem");
  });

  it("/learn takes a subject and substitutes it into the prompt", () => {
    const p = parseSlashInput("/learn the past tense");
    expect(p?.command.kind).toBe("prompt");
    expect(p?.command.requiresArgs).toBe(true);
    expect(p?.command.buildPrompt?.("the past tense")).toContain(
      "the past tense",
    );
  });

  it("/surprise is a no-arg prompt command", () => {
    const p = parseSlashInput("/surprise");
    expect(p?.command.kind).toBe("prompt");
    expect(p?.command.argsHint).toBeUndefined();
    expect(p?.command.buildPrompt?.("")).toBeTruthy();
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
    const r = matchSlashCommands("", { canDerive: true, isLearning: false });
    expect(r.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "btw",
        "help",
        "harder",
        "swap",
        "next-day",
        "topic",
        "learn",
        "surprise",
      ]),
    );
  });

  it("hides action commands when cannot derive, keeps btw/help/prompt macros", () => {
    const r = matchSlashCommands("", {
      canDerive: false,
      isLearning: false,
    }).map((c) => c.name);
    expect(r).toContain("btw");
    expect(r).toContain("help");
    expect(r).toContain("topic");
    expect(r).not.toContain("harder");
    expect(r).not.toContain("swap");
  });

  it("hides prompt macros in a focused lesson, keeps btw/help", () => {
    const r = matchSlashCommands("", {
      canDerive: false,
      isLearning: true,
    }).map((c) => c.name);
    expect(r).toContain("btw");
    expect(r).toContain("help");
    expect(r).not.toContain("topic");
    expect(r).not.toContain("learn");
    expect(r).not.toContain("surprise");
  });

  it("filters by prefix", () => {
    const r = matchSlashCommands("ha", { canDerive: true, isLearning: false });
    expect(r.map((c) => c.name)).toEqual(["harder"]);
  });

  it("startsWith matches ranked before includes matches", () => {
    // "e" appears in "easier" (prefix match) and "harder"/"help"/"next-day" (substring match).
    const r = matchSlashCommands("e", { canDerive: true, isLearning: false });
    expect(r[0]?.name).toBe("easier");
  });
});

describe("prompt macro customization", () => {
  afterEach(() => {
    clearPromptMacroOverride("surprise");
    deleteCustomPromptMacro("test-1");
  });

  it("applies a built-in template override to the resolved prompt", () => {
    setPromptMacroOverride("surprise", { template: "Custom surprise prompt" });
    const cmd = resolvePromptMacros().find((c) => c.name === "surprise");
    expect(cmd?.buildPrompt?.("")).toBe("Custom surprise prompt");
  });

  it("includes a valid custom macro and substitutes {input}", () => {
    upsertCustomPromptMacro({
      id: "test-1",
      name: "debate",
      description: "Debate a topic",
      template: "Let's debate {input}.",
    });
    const cmd = resolvePromptMacros().find((c) => c.name === "debate");
    expect(cmd?.requiresArgs).toBe(true);
    expect(cmd?.buildPrompt?.("AI ethics")).toBe("Let's debate AI ethics.");
  });

  it("skips a custom macro whose name collides with a built-in", () => {
    upsertCustomPromptMacro({
      id: "test-1",
      name: "topic",
      template: "should be ignored {input}",
    });
    const matches = resolvePromptMacros().filter((c) => c.name === "topic");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.buildPrompt?.("x")).not.toContain("should be ignored");
  });
});
