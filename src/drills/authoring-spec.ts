// The drill authoring guide — one document, three consumers:
//   1. "Copy AI authoring guide" in the training center: the user pastes it into ChatGPT/Claude/…
//      together with their idea, and the AI returns an importable drill document.
//   2. The in-app builder agent (agents/drill-builder.ts) uses it as its system prompt.
//   3. It is generated from the same capability registry the validator runs on, so the guide can
//      never drift from what the importer accepts.

import { BUILTIN_DRILL_SEEDS } from "./builtins";
import { DRILL_CAPABILITIES } from "./capabilities";
import { DRILL_FORMAT } from "./format";
import { DRILL_ICON_NAMES } from "./icons";

const TEMPLATE_VARS = `Template variables (substituted by the app inside # Task / # Opening):
- \`{{setup}}\` — the theme/scenario the learner chose on the start page (setup: topic).
- \`{{items}}\` — the numbered due-for-review item list (setup: review-items).
- \`{{native_language}}\`, \`{{target_language}}\`, \`{{level}}\` — the learner's configured languages and level.`;

const WRITING_RULES = `Writing rules:
1. Write # Task and # Opening in ENGLISH (most reliable for the executing model), regardless of the user's language. Multi-language behavior comes from the template variables and explicit instructions like "write the note in the learner's NATIVE language".
2. # Task is the per-turn playbook: what to present each turn, how to react to the learner's answer, what NOT to do. Drills usually start with a line like "X DRILL — this overrides the default \\"keep a flowing conversation\\" behavior." so the agent stops chit-chatting.
3. Do NOT correct or grade the learner inside # Task — a separate correction tutor runs in parallel (configured by \`grading\`). Say so explicitly ("another agent handles grading").
4. NEVER write [[SAY]] tags anywhere — for say-* interactions the app appends the strict output contract itself. A document containing [[SAY]] is rejected.
5. You cannot touch counters, mastery numbers, API keys or app settings — \`mastery\` picks one of the app's bookkeeping routes, and an # Observer can only PROPOSE memory writes that the user must confirm.
6. \`name\`/\`description\`/\`intro\` default to English; add the user's UI language under \`locales\` (e.g. zh-CN) so cards display natively.
7. Put every capability key you used from the "extension capabilities" group into \`requires\` (e.g. requires: [observer]); core fields (interaction/setup/grading/mastery/hints/feed/locales) never need listing.
8. \`icon\` must be one of: ${DRILL_ICON_NAMES.join(", ")}.`;

function capabilityDocs(): string {
  return DRILL_CAPABILITIES.map((c) => c.doc).join("\n\n");
}

function exampleDocs(): string {
  const quickfire = BUILTIN_DRILL_SEEDS[0];
  const dictation = BUILTIN_DRILL_SEEDS[1];
  return `## Complete examples (the app's built-in drills use this exact format)

### Example 1 — a chat-interaction drill (scenario micro-tasks)

\`\`\`\`markdown
${quickfire.sourceMd.trim()}
\`\`\`\`

### Example 2 — a say-hidden drill (dictation; note: no [[SAY]] anywhere — the app appends that contract)

\`\`\`\`markdown
${dictation.sourceMd.trim()}
\`\`\`\`
`;
}

/** The full authoring guide as a single Markdown string. */
export function buildDrillAuthoringSpec(): string {
  return `# Converloop — custom training mode (drill) authoring guide

You are writing a TRAINING MODE document for Converloop, a language-learning desktop app. A training
mode ("drill") reshapes the app's practice conversation into a repeatable exercise: every turn the
conversation agent follows your # Task playbook (present one prompt/sentence/micro-task, react, move
on), while the app's correction tutor, mastery bookkeeping and UI mechanics run around it according
to the frontmatter enums you choose. The four built-in modes (scenario sprint, dictation, shadowing,
weak-spot drill) are written in this same format.

## Document format

A drill is ONE Markdown document: YAML frontmatter between \`---\` lines, then level-1 \`# Section\`
headings. The frontmatter is machine-validated config; the body sections are prompt prose.

Required frontmatter: \`format: ${DRILL_FORMAT}\`, \`name\`, \`description\`.
Optional: \`intro\` (longer start-page text), \`icon\`, \`locales\`, \`tags\`, \`author\`, \`requires\`.

Required body sections: \`# Task\` (per-turn instructions) and \`# Opening\` (the AI's first turn).
Optional: \`# Setup\` (topic recommender guidance), and the extension sections listed below.

## Core configuration (every value the app accepts, with what the app does)

${capabilityDocs()}

## ${TEMPLATE_VARS}

## ${WRITING_RULES}

${exampleDocs()}
## Your output

Reply with EXACTLY ONE complete drill document in a fenced \`\`\`markdown code block — frontmatter
first, then the sections. No commentary inside the block. Make the drill genuinely fit the user's
request: pick the lightest interaction preset that works (chat covers most ideas), keep # Task
concrete and energetic, and keep each turn short.`;
}
