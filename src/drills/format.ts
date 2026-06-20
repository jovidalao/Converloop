// drill@1 document parser/validator. The Markdown document (YAML frontmatter + "# Section" body) is
// the canonical form of a drill; this module turns it into a DrillDefinition or a list of errors
// written so the user can paste them back to whatever AI generated the document.

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  KNOWN_BODY_SECTIONS,
  KNOWN_FRONTMATTER_KEYS,
  supportedCapabilityKeys,
} from "./capabilities";
import { DICTATION_SAY_CLOSE, DICTATION_SAY_OPEN } from "./say";
import type { DrillDefinition } from "./types";

export const LEGACY_DRILL_FORMAT_ID = "lang-agent/drill";
export const DRILL_FORMAT_ID = "converloop/drill";
export const DRILL_FORMAT_VERSION = 1;
export const DRILL_FORMAT = `${DRILL_FORMAT_ID}@${DRILL_FORMAT_VERSION}`;
const SUPPORTED_DRILL_FORMAT_IDS = new Set([
  DRILL_FORMAT_ID,
  LEGACY_DRILL_FORMAT_ID,
]);

const LocaleOverride = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(240).optional(),
    intro: z.string().min(1).max(600).optional(),
  })
  .strip();

// Frontmatter schema. Every capability field is optional with a default reproducing pre-capability
// behavior (compat rule #1). `.strip()` drops unknown keys after they are collected as warnings.
const Frontmatter = z
  .object({
    format: z.string(),
    requires: z.array(z.string()).default([]),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(240),
    intro: z.string().min(1).max(600).optional(),
    icon: z.string().max(40).optional(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    locales: z.record(LocaleOverride).optional(),
    interaction: z.enum(["chat", "say-hidden"]).default("chat"),
    setup: z.enum(["none", "topic", "review-items"]).default("topic"),
    grading: z.enum(["tutor", "standard-answer", "none"]).default("tutor"),
    mastery: z
      .enum(["production", "review", "listening", "none"])
      .default("production"),
    hints: z.enum(["on", "off"]).default("off"),
    feed: z.enum(["none", "listening-words"]).default("none"),
    observer: z
      .object({
        scopes: z.array(z.string()).default([]),
        writeback: z.enum(["none", "propose"]).default("none"),
      })
      .strip()
      .optional(),
    turnActions: z.array(z.string()).optional(),
  })
  .strip();

export type DrillParseResult =
  | { ok: true; def: DrillDefinition; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

interface SplitDocument {
  frontmatterRaw: string;
  sections: Map<string, string>;
  sectionOrder: string[];
}

// Split "---\nyaml\n---\nbody" and slice the body at level-1 "# Heading" lines.
function splitDocument(md: string): SplitDocument | { error: string } {
  const text = md.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^\s*---\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) {
    return {
      error:
        "Document must start with a YAML frontmatter block delimited by `---` lines.",
    };
  }
  const [, frontmatterRaw, body] = m;
  const sections = new Map<string, string>();
  const sectionOrder: string[] = [];
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) {
      sections.set(current, buf.join("\n").trim());
      sectionOrder.push(current);
    }
    buf = [];
  };
  for (const line of body.split("\n")) {
    const h = line.match(/^#\s+(.+?)\s*$/);
    if (h) {
      flush();
      current = h[1];
    } else if (current !== null) {
      buf.push(line);
    } else if (line.trim()) {
      return {
        error: `Unexpected content before the first "# Section" heading: "${line.trim().slice(0, 60)}". The body must consist of level-1 sections (e.g. "# Task").`,
      };
    }
  }
  flush();
  return { frontmatterRaw, sections, sectionOrder };
}

export function parseDrillDocument(md: string): DrillParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!md.trim())
    return { ok: false, errors: ["Document is empty."], warnings };

  const split = splitDocument(md);
  if ("error" in split) return { ok: false, errors: [split.error], warnings };

  let rawFm: unknown;
  try {
    rawFm = parseYaml(split.frontmatterRaw);
  } catch (e) {
    return {
      ok: false,
      errors: [
        `Frontmatter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
      ],
      warnings,
    };
  }
  if (!rawFm || typeof rawFm !== "object" || Array.isArray(rawFm)) {
    return {
      ok: false,
      errors: ["Frontmatter must be a YAML mapping (key: value lines)."],
      warnings,
    };
  }

  // Unknown frontmatter keys: warn and ignore (compat rule #2).
  for (const key of Object.keys(rawFm as Record<string, unknown>)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
      warnings.push(
        `Unknown frontmatter key "${key}" was ignored (not supported by this app version).`,
      );
    }
  }

  const fm = Frontmatter.safeParse(rawFm);
  if (!fm.success) {
    for (const issue of fm.error.issues) {
      errors.push(
        `frontmatter.${issue.path.join(".") || "root"}: ${issue.message}`,
      );
    }
    return { ok: false, errors, warnings };
  }

  // Format id + major version gate (compat rule #3).
  const formatMatch = fm.data.format.match(/^([a-z-]+\/[a-z-]+)@(\d+)$/);
  if (!formatMatch || !SUPPORTED_DRILL_FORMAT_IDS.has(formatMatch[1])) {
    errors.push(
      `frontmatter.format: expected "${DRILL_FORMAT}", got "${fm.data.format}".`,
    );
    return { ok: false, errors, warnings };
  }
  if (Number(formatMatch[2]) !== DRILL_FORMAT_VERSION) {
    errors.push(
      `frontmatter.format: this app supports ${DRILL_FORMAT}; the document declares version ${formatMatch[2]}. Update the app (or regenerate the document for version ${DRILL_FORMAT_VERSION}).`,
    );
    return { ok: false, errors, warnings };
  }

  // `requires` gate: a dependency this app doesn't know is a hard error (the document would silently lose behavior).
  const supported = supportedCapabilityKeys();
  for (const req of fm.data.requires) {
    if (!supported.has(req)) {
      errors.push(
        `requires: this document needs capability "${req}", which this app version does not support. Update the app to use this drill.`,
      );
    }
  }

  // Body sections.
  const task = split.sections.get("Task") ?? "";
  const opening = split.sections.get("Opening") ?? "";
  if (!task) errors.push('Missing required body section "# Task".');
  if (!opening) errors.push('Missing required body section "# Opening".');
  for (const name of split.sectionOrder) {
    if (!KNOWN_BODY_SECTIONS.has(name)) {
      warnings.push(
        `Unknown body section "# ${name}" was ignored (not supported by this app version).`,
      );
    }
  }

  // The [[SAY]] output contract is owned by app code (render.ts) — a hand-written copy in the body
  // would drift from the parser and can break the hidden-sentence masking.
  for (const [name, content] of split.sections) {
    if (
      content.includes(DICTATION_SAY_OPEN) ||
      content.includes(DICTATION_SAY_CLOSE)
    ) {
      errors.push(
        `Section "# ${name}" must not contain ${DICTATION_SAY_OPEN} tags — the app appends the say output contract automatically for say-hidden interactions.`,
      );
    }
  }

  // Cross-field rules.
  if (fm.data.grading === "standard-answer" && fm.data.interaction === "chat") {
    errors.push(
      'grading: "standard-answer" requires interaction: "say-hidden" (the standard answer is the [[SAY]] sentence of the previous turn).',
    );
  }
  if (fm.data.mastery === "listening" && fm.data.interaction !== "say-hidden") {
    warnings.push(
      'mastery: "listening" is meant for say-hidden (dictation-style) drills; other interactions produce no listening evidence.',
    );
  }
  if (fm.data.setup === "review-items" && !task.includes("{{items}}")) {
    warnings.push(
      'setup: "review-items" selected but the # Task section never uses {{items}} — the selected review items would not reach the agent.',
    );
  }
  if (fm.data.setup === "topic" && !task.includes("{{setup}}")) {
    warnings.push(
      "The # Task section never uses {{setup}} — the learner's chosen topic would not reach the agent.",
    );
  }

  const observerBody = split.sections.get("Observer") ?? "";
  if (observerBody && !fm.data.requires.includes("observer")) {
    warnings.push(
      'Document has "# Observer" but does not list "observer" in requires; older app versions would silently drop it.',
    );
  }
  const reportBody = split.sections.get("Report") ?? "";
  if (reportBody && !fm.data.requires.includes("report")) {
    warnings.push(
      'Document has "# Report" but does not list "report" in requires; older app versions would silently drop it.',
    );
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  const def: DrillDefinition = {
    format: DRILL_FORMAT_VERSION,
    name: fm.data.name.trim(),
    description: fm.data.description.trim(),
    icon: fm.data.icon?.trim() || undefined,
    locales: fm.data.locales,
    requires: fm.data.requires,
    interaction: fm.data.interaction,
    setup: fm.data.setup,
    grading: fm.data.grading,
    mastery: fm.data.mastery,
    hints: fm.data.hints,
    feed: fm.data.feed,
    intro: fm.data.intro?.trim() || undefined,
    task,
    opening,
    setupGuidance: split.sections.get("Setup") || undefined,
    observer: observerBody || undefined,
    observerScopes: fm.data.observer?.scopes,
    observerWriteback: fm.data.observer?.writeback,
    report: reportBody || undefined,
    turnActions: fm.data.turnActions,
  };
  return { ok: true, def, warnings };
}

/** Resolve display fields for the current UI locale: exact key first ("zh-CN"), then any entry
 *  sharing the language ("zh" matches a document's "zh-CN" and vice versa). */
export function localizeDrill(
  def: DrillDefinition,
  locale: string,
): { name: string; description: string; intro: string } {
  const locales = def.locales ?? {};
  const language = locale.split("-")[0].toLowerCase();
  const exact = locales[locale];
  const langKey = Object.keys(locales).find(
    (key) => key.split("-")[0].toLowerCase() === language,
  );
  const lang = langKey ? locales[langKey] : undefined;
  const pick = (field: "name" | "description" | "intro") =>
    exact?.[field] ?? lang?.[field] ?? undefined;
  return {
    name: pick("name") ?? def.name,
    description: pick("description") ?? def.description,
    intro: pick("intro") ?? def.intro ?? pick("description") ?? def.description,
  };
}
