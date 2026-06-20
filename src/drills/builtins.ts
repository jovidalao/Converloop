// Built-in drill seeds, parsed eagerly at module load (the documents are compiled in via ?raw).
// Pure data — no DB imports — so db/conversations can use these synchronously to normalize legacy
// modifier JSON ({quickfire:{…}} etc.) into the generic drill modifier at parse time.

import { parseDrillDocument } from "./format";
import dictationMd from "./seeds/dictation.md?raw";
import quickfireMd from "./seeds/quickfire.md?raw";
import reviewDrillMd from "./seeds/review-drill.md?raw";
import type { DrillDefinition } from "./types";

export const BUILTIN_DRILL_IDS = {
  quickfire: "builtin:drill:quickfire",
  dictation: "builtin:drill:dictation",
  reviewDrill: "builtin:drill:review_drill",
} as const;

export interface BuiltinDrillSeed {
  id: string;
  sourceMd: string;
  def: DrillDefinition;
  /** Source texts of previously shipped versions; rows still matching one are auto-upgraded. */
  supersedes: string[];
}

function mustParse(id: string, md: string): DrillDefinition {
  const parsed = parseDrillDocument(md);
  if (!parsed.ok) {
    throw new Error(
      `Built-in drill seed ${id} failed to parse: ${parsed.errors.join("; ")}`,
    );
  }
  return parsed.def;
}

export const BUILTIN_DRILL_SEEDS: BuiltinDrillSeed[] = [
  {
    id: BUILTIN_DRILL_IDS.quickfire,
    sourceMd: quickfireMd,
    def: mustParse(BUILTIN_DRILL_IDS.quickfire, quickfireMd),
    supersedes: [],
  },
  {
    id: BUILTIN_DRILL_IDS.dictation,
    sourceMd: dictationMd,
    def: mustParse(BUILTIN_DRILL_IDS.dictation, dictationMd),
    supersedes: [],
  },
  {
    id: BUILTIN_DRILL_IDS.reviewDrill,
    sourceMd: reviewDrillMd,
    def: mustParse(BUILTIN_DRILL_IDS.reviewDrill, reviewDrillMd),
    supersedes: [],
  },
];

export function getBuiltinDrillSeed(id: string): BuiltinDrillSeed | undefined {
  return BUILTIN_DRILL_SEEDS.find((seed) => seed.id === id);
}
