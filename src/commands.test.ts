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

  it("parses /reply as a compose command", () => {
    const p = parseSlashInput("/reply");
    expect(p?.command.kind).toBe("compose");
    expect(p?.command.buildPrompt).toBeUndefined();
  });

  it("parses a prompt command and builds the expanded prompt from args", () => {
    const p = parseSlashInput("/topic the CAP theorem");
    expect(p?.command.kind).toBe("prompt");
    expect(p?.command.description).toBe("Switch the conversation to a topic");
    expect(p?.rest).toBe("the CAP theorem");
    const prompt = p?.command.buildPrompt?.(p.rest) ?? "";
    expect(prompt).toContain(
      'Switch the conversation to this topic now: "the CAP theorem"',
    );
    expect(prompt).not.toContain("pasted");
  });

  it("/learn takes a subject and substitutes it into the prompt", () => {
    const p = parseSlashInput("/learn the past tense");
    expect(p?.command.kind).toBe("prompt");
    expect(p?.command.requiresArgs).toBe(true);
    expect(p?.command.buildPrompt?.("the past tense")).toContain(
      "the past tense",
    );
  });

  it("/surprise, /recap, /simpler, /keywords are no-arg prompt commands", () => {
    for (const name of ["surprise", "recap", "simpler", "keywords"]) {
      const p = parseSlashInput(`/${name}`);
      expect(p?.command.kind).toBe("prompt");
      expect(p?.command.argsHint).toBeUndefined();
      expect(p?.command.buildPrompt?.("")).toBeTruthy();
    }
  });

  it("/how and /roleplay take a body and substitute it", () => {
    const how = parseSlashInput("/how thanks for covering my shift");
    expect(how?.command.requiresArgs).toBe(true);
    expect(how?.command.buildPrompt?.(how.rest)).toContain(
      "thanks for covering my shift",
    );
    const rp = parseSlashInput("/roleplay returning a parcel");
    expect(rp?.command.requiresArgs).toBe(true);
    expect(rp?.command.buildPrompt?.(rp.rest)).toContain("returning a parcel");
  });

  it("removed branching commands (/scene, /harder) are treated as plain text", () => {
    expect(parseSlashInput("/scene")).toBeNull();
    expect(parseSlashInput("/harder")).toBeNull();
  });

  it("/help was removed: treated as plain text", () => {
    expect(parseSlashInput("/help")).toBeNull();
  });

  it("command name is case-insensitive", () => {
    expect(parseSlashInput("/BTW hi")?.command.name).toBe("btw");
  });

  it("command name with hyphen (custom macro)", () => {
    upsertCustomPromptMacro({
      id: "test-1",
      name: "warm-up",
      template: "Warm me up with {input}.",
    });
    try {
      expect(parseSlashInput("/warm-up jokes")?.command.name).toBe("warm-up");
    } finally {
      deleteCustomPromptMacro("test-1");
    }
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
  it("empty token returns all available commands", () => {
    const r = matchSlashCommands("", { isLearning: false });
    expect(r.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "reply",
        "btw",
        "topic",
        "roleplay",
        "learn",
        "surprise",
        "how",
        "simpler",
        "keywords",
        "recap",
      ]),
    );
    // Branching commands were removed from the slash menu.
    expect(r.map((c) => c.name)).not.toContain("harder");
    expect(r.map((c) => c.name)).not.toContain("scene");
  });

  it("hides prompt macros and /reply in a focused lesson, keeps /btw", () => {
    const r = matchSlashCommands("", { isLearning: true }).map((c) => c.name);
    expect(r).toContain("btw");
    expect(r).not.toContain("reply");
    expect(r).not.toContain("topic");
    expect(r).not.toContain("learn");
    expect(r).not.toContain("simpler");
    expect(r).not.toContain("keywords");
    expect(r).not.toContain("recap");
  });

  it("filters by prefix", () => {
    const r = matchSlashCommands("key", { isLearning: false });
    expect(r.map((c) => c.name)).toEqual(["keywords"]);
  });

  it("startsWith matches ranked before includes matches", () => {
    // "s" prefixes "surprise"/"simpler"; it appears mid-word in "keywords" (substring match).
    const r = matchSlashCommands("s", { isLearning: false });
    expect(["surprise", "simpler"]).toContain(r[0]?.name);
    const surpriseIdx = r.findIndex((c) => c.name === "surprise");
    const keywordsIdx = r.findIndex((c) => c.name === "keywords");
    expect(surpriseIdx).toBeLessThan(keywordsIdx);
  });
});

describe("prompt macro customization", () => {
  afterEach(() => {
    clearPromptMacroOverride("surprise");
    clearPromptMacroOverride("topic");
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

  it("marks edited built-ins and custom macros for the menu badge", () => {
    setPromptMacroOverride("surprise", { template: "Custom surprise prompt" });
    upsertCustomPromptMacro({
      id: "test-1",
      name: "debate",
      template: "Let's debate {input}.",
    });
    const cmds = resolvePromptMacros();
    expect(cmds.find((c) => c.name === "surprise")?.source).toBe("edited");
    expect(cmds.find((c) => c.name === "debate")?.source).toBe("custom");
    expect(cmds.find((c) => c.name === "topic")?.source).toBeUndefined();
  });

  it("localized menu key applies only until the user overrides that text", () => {
    expect(
      resolvePromptMacros().find((c) => c.name === "topic")?.descriptionKey,
    ).toBe("slashCommands.topic");
    setPromptMacroOverride("topic", { description: "My topic switcher" });
    const cmd = resolvePromptMacros().find((c) => c.name === "topic");
    expect(cmd?.descriptionKey).toBeUndefined();
    expect(cmd?.description).toBe("My topic switcher");
    // The untouched args hint still shows localized.
    expect(cmd?.argsHintKey).toBe("slashCommands.topicHint");
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
