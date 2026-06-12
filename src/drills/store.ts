// Drill storage: rows in learning_agent with kind="drill". The Markdown document (source_md) is the
// single source of truth; name/description/prompt columns are derived caches for listing. Built-ins
// are seeded from the compiled-in documents and are read-only in the UI (users duplicate to
// customize), so a built-in row that drifts from its seed is simply re-seeded.

import { asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { type LearningAgent, learningAgent } from "../db/schema";
import { BUILTIN_DRILL_SEEDS } from "./builtins";
import { localizeDrill, parseDrillDocument } from "./format";
import type { DrillDefinition, DrillSummary } from "./types";

export interface DrillRecord {
  id: string;
  builtIn: boolean;
  enabled: boolean;
  sourceMd: string;
  def: DrillDefinition;
  createdAt: number;
  updatedAt: number;
}

// Parse cache keyed by id+updatedAt so list/get calls don't re-parse unchanged documents.
const parseCache = new Map<
  string,
  { updatedAt: number; def: DrillDefinition }
>();

function hydrateDrill(row: LearningAgent): DrillRecord | null {
  const sourceMd = row.sourceMd ?? "";
  if (!sourceMd.trim()) return null;
  const cached = parseCache.get(row.id);
  if (cached && cached.updatedAt === row.updatedAt) {
    return {
      id: row.id,
      builtIn: row.builtIn === 1,
      enabled: row.enabled === 1,
      sourceMd,
      def: cached.def,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  const parsed = parseDrillDocument(sourceMd);
  if (!parsed.ok) return null; // unparseable row (should not happen — importer validates) — hide it
  parseCache.set(row.id, { updatedAt: row.updatedAt, def: parsed.def });
  return {
    id: row.id,
    builtIn: row.builtIn === 1,
    enabled: row.enabled === 1,
    sourceMd,
    def: parsed.def,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function drillSummary(
  record: DrillRecord,
  locale: string,
): DrillSummary {
  const display = localizeDrill(record.def, locale);
  return {
    id: record.id,
    builtIn: record.builtIn,
    name: display.name,
    description: display.description,
    intro: display.intro,
    icon: record.def.icon,
    interaction: record.def.interaction,
    setup: record.def.setup,
    def: record.def,
  };
}

export async function ensureBuiltInDrills(): Promise<void> {
  const now = Date.now();
  for (const seed of BUILTIN_DRILL_SEEDS) {
    const [existing] = await db
      .select()
      .from(learningAgent)
      .where(eq(learningAgent.id, seed.id))
      .limit(1);
    if (!existing) {
      await db.insert(learningAgent).values({
        id: seed.id,
        name: seed.def.name,
        description: seed.def.description,
        prompt: seed.def.task,
        dataScopeJson: "[]",
        kind: "drill",
        sourceMd: seed.sourceMd,
        builtIn: 1,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    // Built-in drills are read-only (UI offers "duplicate to customize" instead of editing), so any
    // drift from the current seed — old release or accidental edit — is healed to the latest version.
    if (existing.sourceMd !== seed.sourceMd) {
      await db
        .update(learningAgent)
        .set({
          name: seed.def.name,
          description: seed.def.description,
          prompt: seed.def.task,
          sourceMd: seed.sourceMd,
          updatedAt: now,
        })
        .where(eq(learningAgent.id, seed.id));
    }
  }
}

export async function listDrills(): Promise<DrillRecord[]> {
  const rows = await db
    .select()
    .from(learningAgent)
    .where(eq(learningAgent.kind, "drill"))
    .orderBy(desc(learningAgent.builtIn), asc(learningAgent.createdAt));
  return rows
    .map(hydrateDrill)
    .filter((record): record is DrillRecord => record !== null);
}

export async function getDrill(id: string): Promise<DrillRecord | null> {
  const [row] = await db
    .select()
    .from(learningAgent)
    .where(eq(learningAgent.id, id))
    .limit(1);
  if (row?.kind !== "drill") return null;
  return hydrateDrill(row);
}

/** Create a custom drill from an already-validated document. */
export async function createDrill(
  sourceMd: string,
  def: DrillDefinition,
  id = crypto.randomUUID(),
): Promise<string> {
  const now = Date.now();
  await db.insert(learningAgent).values({
    id,
    name: def.name,
    description: def.description,
    prompt: def.task,
    dataScopeJson: "[]",
    kind: "drill",
    sourceMd,
    builtIn: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Update a custom drill's document (built-ins are read-only). */
export async function updateDrill(
  id: string,
  sourceMd: string,
  def: DrillDefinition,
): Promise<void> {
  await db
    .update(learningAgent)
    .set({
      name: def.name,
      description: def.description,
      prompt: def.task,
      sourceMd,
      updatedAt: Date.now(),
    })
    .where(eq(learningAgent.id, id));
}
