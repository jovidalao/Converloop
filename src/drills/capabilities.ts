// Capability registry — the extensibility backbone of the drill format.
// Every customization axis (intervention point) is one entry here. The Zod validator, the runtime
// dispatch and the AI authoring spec all derive from this table, so adding a new axis = adding one
// entry (plus its runtime binding) and everything else follows.
//
// Compatibility rules (enforced by format.ts / the importer):
//  1. Within drill@1, capabilities are only ever ADDED, each as optional config with a default that
//     reproduces the pre-capability behavior — existing documents keep working with no migration.
//  2. A document lists the capabilities it depends on in `requires`. Unknown required capability →
//     hard import error ("app too old"). Unknown frontmatter keys / body sections NOT covered by
//     `requires` → warn and ignore (graceful degradation).
//  3. Breaking format changes bump the major version (drill@2) and ship a code migration.

export interface DrillCapability {
  key: string;
  /** Frontmatter keys owned by this capability (used to derive `requires` on export/generation). */
  frontmatterKeys: string[];
  /** Body section headings owned by this capability. */
  bodySections: string[];
  /** True for capabilities every drill uses implicitly (never needs listing in `requires`). */
  core?: boolean;
  /** Authoring-spec fragment (English; embedded in the copy-for-AI document). */
  doc: string;
}

export const DRILL_CAPABILITIES: DrillCapability[] = [
  {
    key: "interaction",
    frontmatterKeys: ["interaction"],
    bodySections: [],
    core: true,
    doc: `\`interaction\` — the per-turn UI mechanic preset (this is app code; you only pick one):
- \`chat\` (default): a normal chat composer. The learner types or speaks freely. Use this for prompt-and-respond drills (translation, debate, role-play, retrieval tasks…).
- \`say-hidden\`: each turn your reply must end with ONE target sentence; the app HIDES the sentence behind a listen card, speaks it aloud (TTS), and the learner types what they hear (dictation family). The app appends the strict output contract automatically — do NOT write [[SAY]] tags yourself.`,
  },
  {
    key: "setup",
    frontmatterKeys: ["setup"],
    bodySections: ["Setup"],
    core: true,
    doc: `\`setup\` — what the start page asks for before the session:
- \`topic\` (default): the learner picks or types a theme/scenario; it reaches your Task text as \`{{setup}}\` and the app shows recommended topic chips. An optional \`# Setup\` body section adds guidance for the topic recommender (what kind of topics fit this drill).
- \`none\`: no start page input; the session starts immediately.
- \`review-items\`: the app (code, not the model) selects the learner's due-for-review weak items and snapshots them into the session; they reach your Task text as \`{{items}}\` (a numbered list with key/type/example). The tutor's correct/error signals are routed onto exactly these items.`,
  },
  {
    key: "grading",
    frontmatterKeys: ["grading"],
    bodySections: [],
    core: true,
    doc: `\`grading\` — how the correction tutor grades each learner answer (runs in parallel, separate from your reply):
- \`tutor\` (default): normal free-form correction of the learner's production.
- \`standard-answer\`: the tutor compares the answer against the [[SAY]] sentence your previous turn presented (requires \`interaction: say-hidden\`).
- \`none\`: no correction at all for this drill.`,
  },
  {
    key: "mastery",
    frontmatterKeys: ["mastery"],
    bodySections: [],
    core: true,
    doc: `\`mastery\` — which memory dimension graded signals are booked into. Bookkeeping is ALWAYS done by app code; neither you nor the runtime LLM ever touch counts:
- \`production\` (default): normal production mastery (errors/corrects update the weak-item ledger).
- \`review\`: same ledger, but evidence is tagged as targeted review (use with \`setup: review-items\`).
- \`listening\`: the isolated listening dimension (missed-by-ear words; excluded from production queries). Use for dictation-style drills.
- \`none\`: record nothing (use when the signal is too noisy to count, e.g. raw speech-recognition output).`,
  },
  {
    key: "hints",
    frontmatterKeys: ["hints"],
    bodySections: [],
    core: true,
    doc: `\`hints\` — \`on\` | \`off\` (default \`off\`): whether the app's input-box coaching hint runs during this drill. Leave \`off\` for drills where a suggested reply would defeat the exercise (retrieval, dictation).`,
  },
  {
    key: "feed",
    frontmatterKeys: ["feed"],
    bodySections: [],
    core: true,
    doc: `\`feed\` — per-turn data the app weaves into your instructions:
- \`none\` (default).
- \`listening-words\`: the app appends the learner's tracked listening-weak words with instructions to re-expose one per sentence (dictation-style drills).`,
  },
  {
    key: "locales",
    frontmatterKeys: ["locales"],
    bodySections: [],
    core: true,
    doc: `\`locales\` — optional per-locale overrides for the display fields, e.g.:
\`\`\`yaml
locales:
  zh-CN: { name: 口头翻译, description: 看母语句子,口头说出目标语 }
\`\`\`
Write \`name\`/\`description\`/\`intro\` in English by default and add the user's UI language here.`,
  },
  {
    key: "observer",
    frontmatterKeys: ["observer"],
    bodySections: ["Observer"],
    doc: `\`# Observer\` (capability \`observer\`) — an optional extra agent that runs in parallel after each learner answer and posts a short note to the coach panel (e.g. a fluency score, a politeness check). Configure with:
\`\`\`yaml
observer:
  scopes: [weak_all, profile]   # learning data it may read
  writeback: none               # none | propose (proposals always require user confirmation)
\`\`\`
The section body is the observer's instructions. It can never write memory directly.`,
  },
  {
    key: "report",
    frontmatterKeys: [],
    bodySections: ["Report"],
    doc: `\`# Report\` (capability \`report\`) — optional end-of-session report instructions. When present, drill sessions get a "session report" action that runs these instructions over the transcript and shows a structured wrap-up.`,
  },
  {
    key: "turn-actions",
    frontmatterKeys: ["turnActions"],
    bodySections: [],
    doc: `\`turnActions\` (capability \`turn-actions\`) — which reply-action buttons stay available on drill turns. Subset of \`[explain, bilingual, redo, branch]\`; omit the key to keep the interaction preset's defaults. Listing can only RESTRICT further (it never re-enables an action the preset hides). Drop \`redo\` when a generated answer would defeat the exercise.`,
  },
];

const KEYS = new Set(DRILL_CAPABILITIES.map((c) => c.key));

export function supportedCapabilityKeys(): ReadonlySet<string> {
  return KEYS;
}

/** Known frontmatter keys across all capabilities + document basics (used for unknown-key warnings). */
export const KNOWN_FRONTMATTER_KEYS = new Set<string>([
  "format",
  "requires",
  "name",
  "description",
  "intro",
  "icon",
  "tags",
  "author",
  "version",
  ...DRILL_CAPABILITIES.flatMap((c) => c.frontmatterKeys),
]);

/** Known body sections (capability-owned + the two required prose sections). */
export const KNOWN_BODY_SECTIONS = new Set<string>([
  "Task",
  "Opening",
  ...DRILL_CAPABILITIES.flatMap((c) => c.bodySections),
]);

/** Capability keys a parsed definition actually uses (stamped into `requires` on export/generation). */
export function usedCapabilityKeys(def: {
  observer?: string;
  report?: string;
  turnActions?: string[];
}): string[] {
  const used: string[] = [];
  if (def.observer) used.push("observer");
  if (def.report) used.push("report");
  if (def.turnActions) used.push("turn-actions");
  return used;
}
