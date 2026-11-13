// Plan audit of the scoped store check: EXPLAIN QUERY PLAN for every statement `validateAuthorityChanges` prepares,
// listing each SCAN of a table that grows with runs or the command journal. A report, not a gate.
// Run: TZ=UTC node_modules/.bin/tsx tests/perf/check-closure-plan-audit.ts
import "./fake-keychain-entry.js";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type AuthorityRowChange, validateAuthorityChanges, validateAuthorityStore } from "../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityTableNameSchema } from "../../src/models/config/authority.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { seedCheckClosureStore } from "../support/fixtures/storage/check-closure-store.js";
import { traceSqliteStatements } from "./sqlite-statement-counter.js";
import { seedStorageReadFixture } from "./storage-read-fixture.js";

const RUNS = 1_000;
/** Tables whose size does not grow with runs or the journal; every other registry table is treated as growing. */
const BOUNDED = new Set(["database_states", "settings", "worker_pools", "worker_slots", "auth_leases", "assistant_model_preference", "workbook_types"]);
const RowSchema = z.record(z.string(), z.unknown());

interface ChangeKind { readonly code: string; readonly kind: string; readonly store: "runs" | "closure"; readonly tables: readonly string[];
  readonly insert?: boolean; readonly where?: string }

const KINDS: readonly ChangeKind[] = [
  { code: "a", kind: "(a) runs update (heartbeat)", store: "runs", tables: ["runs"] },
  { code: "b", kind: "(b) timeline_events insert", store: "runs", tables: ["timeline_events"], insert: true },
  { code: "c", kind: "(c) commands + command_audits insert", store: "closure", tables: ["commands", "command_audits"], insert: true },
  { code: "d", kind: "(d) run_search update", store: "runs", tables: ["run_search"] },
  { code: "e", kind: "(e) write_intents update + write_attempts insert", store: "closure", tables: ["write_intents", "write_attempts"] },
  { code: "f", kind: "(f) database_states update (search state unchanged)", store: "runs", tables: ["database_states"] },
  { code: "g", kind: "(g) workbook_operations insert", store: "closure", tables: ["workbook_operations"], insert: true },
  { code: "h", kind: "(h) settings_snapshots update", store: "runs", tables: ["settings_snapshots"] },
  // Every policy and invariant scope: one same-image update of each registry table, an active run for `runs` so the worker
  // key is emitted.
  ...AuthorityTableNameSchema.options.map((table): ChangeKind => ({ code: table, kind: `update of one ${table} row`, store: "closure", tables: [table],
    ...(table === "runs" ? { where: "state IN ('claimed','validating','running')" } : {}) })),
];

function tableExists(database: DatabaseSync, table: string): boolean {
  return database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table) !== undefined;
}

function changeFor(database: DatabaseSync, kind: ChangeKind, table: string): AuthorityRowChange | undefined {
  if (!tableExists(database, table)) return undefined;
  const row = database.prepare(`SELECT * FROM ${table}${kind.where === undefined ? "" : ` WHERE ${kind.where}`} LIMIT 1`).get();
  if (row === undefined) return undefined;
  const stored = RowSchema.parse(row);
  const name = AuthorityTableNameSchema.parse(table);
  return kind.insert === true ? { table: name, after: stored } : { table: name, before: stored, after: stored };
}

/** The plan names an alias; resolve `<table> AS <alias>` from the statement, and treat virtual tables as input-sized. */
function scanTable(plan: string, sql: string): string | undefined {
  const scanned = /^SCAN (?:TABLE )?(\w+)/.exec(plan)?.[1];
  if (scanned === undefined) return undefined;
  if (plan.includes("VIRTUAL TABLE")) return "json_each (virtual)";
  const alias = new RegExp(`\\b(?:FROM|JOIN)\\s+(\\w+)\\s+(?:AS\\s+)?${scanned}\\b`, "i").exec(sql)?.[1];
  return alias ?? scanned;
}

function classify(table: string): string {
  if (table.startsWith("json_each")) return "input-sized";
  return BOUNDED.has(table) ? "bounded" : "GROWING";
}

function explain(database: DatabaseSync, sql: string): readonly string[] {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
  return rows.map(row => z.object({ detail: z.string() }).parse(row).detail);
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

interface Audit { readonly rows: Map<string, string[]>; readonly timings: string[] }

function auditStore(path: string, kinds: readonly ChangeKind[], audit: Audit): void {
  const database = new DatabaseSync(path);
  try {
    for (const kind of kinds) {
      const changes = kind.tables.flatMap(table => changeFor(database, kind, table) ?? []);
      if (changes.length === 0) { audit.timings.push(`${kind.kind}: skipped (no ${kind.tables.join("/")} rows in the ${kind.store} store)`); continue; }
      const scopedStart = systemClock.monotonicMs();
      const { statements } = traceSqliteStatements(() => { validateAuthorityChanges(database, changes); });
      const scopedMs = systemClock.monotonicMs() - scopedStart;
      const wholeStart = systemClock.monotonicMs();
      const whole = traceSqliteStatements(() => { validateAuthorityStore(database); });
      const wholeMs = systemClock.monotonicMs() - wholeStart;
      audit.timings.push(`${kind.kind} [${changes.map(change => change.table).join("+")}] single run: scoped ${String(statements.length)} statements ${scopedMs.toFixed(1)} ms; whole-store ${String(whole.statements.length)} statements ${wholeMs.toFixed(1)} ms`);
      const seen = new Set<string>();
      for (const { sql } of statements) {
        const key = cell(sql);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const plan of explain(database, sql)) {
          const table = scanTable(plan, key);
          if (table === undefined) continue;
          const row = `| ${table} | ${classify(table)} | \`${cell(plan)}\` | \`${key.slice(0, 160)}\` |`;
          audit.rows.set(row, [...audit.rows.get(row) ?? [], kind.code]);
        }
      }
    }
  } finally {
    database.close();
  }
}

export async function runCheckClosurePlanAudit(): Promise<void> {
  const audit: Audit = { rows: new Map(), timings: [] };
  const started = systemClock.monotonicMs();
  const fixture = await seedStorageReadFixture(RUNS);
  const closure = await seedCheckClosureStore({ activeRuns: true });
  try {
    auditStore(fixture.path, KINDS.filter(kind => kind.store === "runs"), audit);
    auditStore(closure.databasePath, KINDS.filter(kind => kind.store === "closure"), audit);
  } finally {
    closure.closeDatabase();
    await closure.cleanup();
    await fixture.close();
  }
  const order = (row: string) => (row.includes("| GROWING |") ? 0 : 1);
  const lines = [...audit.rows].sort(([a], [b]) => order(a) - order(b)).map(([row, kinds]) => `| ${[...new Set(kinds)].join(", ")} ${row}`);
  process.stdout.write([
    `# Scoped check plan audit (${String(RUNS)}-run store plus the all-tables closure store; ${((systemClock.monotonicMs() - started) / 1000).toFixed(1)} s)`, "",
    "Change kinds: (a) runs update, (b) timeline_events insert, (c) commands + audits insert, (d) run_search update, (e) write_intents + attempts, (f) database_states, (g) workbook_operations, (h) settings_snapshots; a table name is a same-image update of one row of that table in the closure store (an active run for runs).", "",
    "| Change kinds | Table scanned | Growth | Plan line | Statement (first 160 chars) |", "|---|---|---|---|---|",
    ...lines, "", "## Timings (one cold run each, not a benchmark)", "", ...audit.timings.map(line => `- ${line}`), "",
  ].join("\n"));
}

const entryPath = process.argv[1];
if (entryPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath))) {
  await runCheckClosurePlanAudit();
  // Something the fixtures leave open keeps the loop alive after the report; exit once stdout has flushed.
  process.stdout.write("", () => { process.exit(0); });
}
