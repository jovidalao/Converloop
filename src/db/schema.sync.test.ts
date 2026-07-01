// Guards the fact stated at the top of schema.ts: src-tauri's migrations and
// this file's Drizzle tables are kept in sync manually, with no shared source
// of truth. Parses the Rust migration SQL as text (no need to run SQLite) and
// diffs its columns against each Drizzle table so a one-sided edit fails CI
// instead of only surfacing as a runtime write error.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  agentJob,
  appState,
  conversation,
  learningAgent,
  learningProject,
  masteryEvent,
  masteryItem,
  memoryProposal,
  turn,
  turnAnnotation,
} from "./schema";

const LIB_RS_PATH = fileURLToPath(
  new URL("../../src-tauri/src/lib.rs", import.meta.url),
);

// Each Drizzle table paired with the SQL table name used in the Rust migrations.
const TABLES: [string, Table][] = [
  ["mastery_item", masteryItem],
  ["mastery_event", masteryEvent],
  ["conversation", conversation],
  ["learning_agent", learningAgent],
  ["turn_annotation", turnAnnotation],
  ["memory_proposal", memoryProposal],
  ["agent_job", agentJob],
  ["learning_project", learningProject],
  ["app_state", appState],
  ["turn", turn],
];

function addColumn(
  columns: Record<string, Set<string>>,
  table: string,
  column: string,
): void {
  if (!columns[table]) columns[table] = new Set();
  columns[table].add(column);
}

// Every column a table has ever gained: the initial CREATE TABLE plus every
// later `ALTER TABLE ... ADD COLUMN` (migrations never rename or drop a
// column in this codebase — see lib.rs).
function rustColumnsByTable(rustSource: string): Record<string, Set<string>> {
  const columns: Record<string, Set<string>> = {};

  for (const match of rustSource.matchAll(
    /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g,
  )) {
    const [, table, body] = match;
    for (const line of body.split("\n")) {
      const name = line.trim().split(/\s+/)[0]?.replace(/,$/, "");
      if (name) addColumn(columns, table, name);
    }
  }

  for (const match of rustSource.matchAll(
    /ALTER TABLE (\w+) ADD COLUMN (\w+)/g,
  )) {
    const [, table, column] = match;
    addColumn(columns, table, column);
  }

  return columns;
}

describe("schema.ts stays in sync with src-tauri migrations", () => {
  const rustColumns = rustColumnsByTable(readFileSync(LIB_RS_PATH, "utf-8"));

  it.each(TABLES)("%s matches the Rust table", (sqlTableName, table) => {
    const rust = rustColumns[sqlTableName];
    expect(
      rust,
      `no "CREATE TABLE IF NOT EXISTS ${sqlTableName}" found in lib.rs`,
    ).toBeDefined();

    const drizzleColumns = new Set(
      Object.values(getTableColumns(table)).map(
        (col) => (col as { name: string }).name,
      ),
    );

    const missingInRust = [...drizzleColumns].filter((c) => !rust.has(c));
    const missingInSchema = [...rust].filter((c) => !drizzleColumns.has(c));

    expect(
      missingInRust,
      `schema.ts "${sqlTableName}" has columns lib.rs doesn't create`,
    ).toEqual([]);
    expect(
      missingInSchema,
      `lib.rs "${sqlTableName}" has columns schema.ts doesn't declare`,
    ).toEqual([]);
  });
});
