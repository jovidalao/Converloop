import { describe, expect, it } from "vitest";
import { extractDrillDocument } from "../agents/drill-builder";
import { buildDrillAuthoringSpec } from "./authoring-spec";
import { localizeDrill, parseDrillDocument } from "./format";

const VALID_DOC = `---
format: converloop/drill@1
name: Oral Translation
description: Translate native-language sentences aloud.
locales:
  zh-CN: { name: 口头翻译, description: 看母语句子,口头说出目标语。 }
icon: languages
interaction: chat
setup: topic
grading: tutor
mastery: production
hints: off
---

# Task

Each turn, give the learner ONE {{native_language}} sentence themed around "{{setup}}" to translate aloud into {{target_language}}, calibrated to {{level}}. After they answer, give a one-line natural reference translation, then the next sentence. Do not correct — another agent handles grading.

# Opening

Present the first sentence immediately. No greeting.
`;

describe("parseDrillDocument", () => {
  it("parses a complete custom document with locales", () => {
    const result = parseDrillDocument(VALID_DOC);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.def.name).toBe("Oral Translation");
    expect(result.def.interaction).toBe("chat");
    expect(result.def.task).toContain("{{setup}}");
    expect(result.def.opening).toContain("first sentence");
    expect(result.warnings).toEqual([]);
  });

  it("applies defaults for omitted capability fields (compat rule #1)", () => {
    const minimal = `---
format: converloop/drill@1
name: Minimal
description: Minimal drill.
---

# Task

Do the thing with "{{setup}}".

# Opening

Start now.
`;
    const result = parseDrillDocument(minimal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.def.interaction).toBe("chat");
    expect(result.def.setup).toBe("topic");
    expect(result.def.grading).toBe("tutor");
    expect(result.def.mastery).toBe("production");
    expect(result.def.hints).toBe("off");
    expect(result.def.feed).toBe("none");
  });

  it("rejects a missing # Task section", () => {
    const result = parseDrillDocument(VALID_DOC.replace("# Task", "# NotTask"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain('"# Task"');
  });

  it("rejects hand-written [[SAY]] tags (the app owns the contract)", () => {
    const result = parseDrillDocument(
      VALID_DOC.replace("No greeting.", "Wrap it as [[SAY]]x[[/SAY]]."),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("[[SAY]]");
  });

  it("hard-fails unknown required capabilities, but only warns on unknown optional keys (compat rule #2)", () => {
    const unknownRequire = parseDrillDocument(
      VALID_DOC.replace(
        "format: converloop/drill@1",
        "format: converloop/drill@1\nrequires: [time-machine]",
      ),
    );
    expect(unknownRequire.ok).toBe(false);
    if (!unknownRequire.ok) {
      expect(unknownRequire.errors.join(" ")).toContain("time-machine");
    }

    const unknownKey = parseDrillDocument(
      VALID_DOC.replace(
        "format: converloop/drill@1",
        "format: converloop/drill@1\nfutureKnob: 3",
      ),
    );
    expect(unknownKey.ok).toBe(true);
    if (unknownKey.ok) {
      expect(unknownKey.warnings.join(" ")).toContain("futureKnob");
    }
  });

  it("rejects a future major format version (compat rule #3)", () => {
    const result = parseDrillDocument(
      VALID_DOC.replace("converloop/drill@1", "converloop/drill@2"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("version 2");
  });

  it("rejects standard-answer grading on a chat interaction", () => {
    const result = parseDrillDocument(
      VALID_DOC.replace("grading: tutor", "grading: standard-answer"),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a say-hidden custom drill", () => {
    const result = parseDrillDocument(
      VALID_DOC.replace("interaction: chat", "interaction: say-hidden")
        .replace("grading: tutor", "grading: standard-answer")
        .replace("mastery: production", "mastery: listening"),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts legacy lang-agent drill documents", () => {
    const legacy = VALID_DOC.replace(
      "converloop/drill@1",
      "lang-agent/drill@1",
    );
    const result = parseDrillDocument(legacy);
    expect(result.ok).toBe(true);
  });

  it("warns when setup: topic but {{setup}} never appears in # Task", () => {
    const result = parseDrillDocument(
      VALID_DOC.replace('themed around "{{setup}}" ', ""),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.join(" ")).toContain("{{setup}}");
    }
  });
});

describe("localizeDrill", () => {
  it("resolves exact locale, language fallback, then defaults", () => {
    const result = parseDrillDocument(VALID_DOC);
    if (!result.ok) throw new Error("doc should parse");
    expect(localizeDrill(result.def, "zh-CN").name).toBe("口头翻译");
    expect(localizeDrill(result.def, "zh").name).toBe("口头翻译");
    expect(localizeDrill(result.def, "en").name).toBe("Oral Translation");
    // intro falls back to description when absent.
    expect(localizeDrill(result.def, "en").intro).toBe(
      "Translate native-language sentences aloud.",
    );
  });
});

describe("buildDrillAuthoringSpec", () => {
  it("embeds the format id, every core enum, and the built-in examples", () => {
    const spec = buildDrillAuthoringSpec();
    expect(spec).toContain("converloop/drill@1");
    for (const v of [
      "say-hidden",
      "say-visible",
      "review-items",
      "standard-answer",
      "listening",
    ]) {
      expect(spec).toContain(v);
    }
    expect(spec).toContain("RAPID-FIRE Q&A DRILL");
    expect(spec).toContain("DICTATION DRILL");
    expect(spec).toContain("NEVER write [[SAY]] tags");
  });
});

describe("extractDrillDocument", () => {
  it("pulls the fenced markdown block out of an AI reply", () => {
    const reply = `Here you go!\n\n\`\`\`markdown\n---\nformat: converloop/drill@1\n---\n\n# Task\n\nx\n\`\`\`\n\nEnjoy!`;
    const md = extractDrillDocument(reply);
    expect(md.startsWith("---")).toBe(true);
    expect(md).not.toContain("Enjoy");
  });

  it("falls back to the raw reply when it already starts with frontmatter", () => {
    const bare = "---\nformat: converloop/drill@1\n---\n\n# Task\n\nx";
    expect(extractDrillDocument(bare)).toBe(bare);
  });
});

describe("custom say drills (render pipeline)", () => {
  const sayDoc = VALID_DOC.replace(
    "interaction: chat",
    "interaction: say-hidden",
  )
    .replace("grading: tutor", "grading: standard-answer")
    .replace("mastery: production", "mastery: listening");

  it("appends the code-owned say contract to a custom say-hidden drill", async () => {
    const { renderDrillInstructions, renderDrillOpening } = await import(
      "./render"
    );
    const parsed = parseDrillDocument(sayDoc);
    if (!parsed.ok) throw new Error("doc should parse");
    const block = renderDrillInstructions(parsed.def, { setup: "travel" });
    expect(block).toContain("[[SAY]]");
    expect(block).toContain("NEVER write the upcoming sentence");
    const opening = renderDrillOpening(parsed.def, { setup: "travel" });
    expect(opening).toContain("[[SAY]]the sentence[[/SAY]]");
  });

  it("keeps chat drills free of the say contract in both task and opening", async () => {
    const { renderDrillInstructions, renderDrillOpening } = await import(
      "./render"
    );
    const parsed = parseDrillDocument(VALID_DOC);
    if (!parsed.ok) throw new Error("doc should parse");
    expect(renderDrillInstructions(parsed.def, { setup: "x" })).not.toContain(
      "[[SAY]]",
    );
    expect(renderDrillOpening(parsed.def, { setup: "x" })).not.toContain(
      "[[SAY]]",
    );
  });

  it("substitutes language template variables", async () => {
    const { renderDrillInstructions } = await import("./render");
    const parsed = parseDrillDocument(VALID_DOC);
    if (!parsed.ok) throw new Error("doc should parse");
    const block = renderDrillInstructions(
      parsed.def,
      { setup: "x" },
      { nativeLanguage: "Chinese", targetLanguage: "English", level: "B1" },
    );
    expect(block).toContain("ONE Chinese sentence");
    expect(block).toContain("into English");
    expect(block).toContain("calibrated to B1");
  });
});

describe("extension capabilities (observer / report / turnActions)", () => {
  const extendedDoc = `${VALID_DOC.replace(
    "format: converloop/drill@1",
    `format: converloop/drill@1
requires: [observer, report, turn-actions]
observer:
  scopes: [weak_all, profile]
  writeback: propose
turnActions: [explain, bilingual]`,
  )}
# Observer

Score the fluency of each answer from 1-5 and note hesitation patterns.

# Report

Summarize sentences attempted and the three structures that slowed the learner down most.
`;

  it("parses observer/report sections with their config", () => {
    const result = parseDrillDocument(extendedDoc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.def.observer).toContain("fluency");
    expect(result.def.observerScopes).toEqual(["weak_all", "profile"]);
    expect(result.def.observerWriteback).toBe("propose");
    expect(result.def.report).toContain("Summarize");
    expect(result.def.turnActions).toEqual(["explain", "bilingual"]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when extension sections are present but not listed in requires", () => {
    const noRequires = extendedDoc.replace(
      "requires: [observer, report, turn-actions]\n",
      "",
    );
    const result = parseDrillDocument(noRequires);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toContain("observer");
    expect(result.warnings.join(" ")).toContain("report");
  });
});
