// Plan audit of the scoped store check: EXPLAIN QUERY PLAN for every statement `validateAuthorityChanges` prepares after one
// raw edit through the capture triggers, listing each SCAN of a table that grows with runs or the command journal. The plan
// test (check-closure-plan.test.ts) gates on it; this entry point prints the report.
// Run: TZ=UTC node_modules/.bin/tsx tests/perf/check-closure-plan-audit.ts
import "./fake-keychain-entry.js";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readAuthorityChanges, readSingletonImage, validateAuthorityChanges, validateAuthorityStore, type AuthorityChangeRoute } from "../../src/backend/storage/sqlite/authority-database.js";
import { currentRowKey, singletonChangeKeys } from "../../src/backend/storage/sqlite/authority-change-log.js";
import { AuthorityTableNameSchema } from "../../src/models/config/authority.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { seedCheckClosureStore } from "../support/fixtures/storage/check-closure-store.js";
import { dropGuardTriggers, logCursor } from "../support/fixtures/storage/raw-authority-writer.js";
import { traceSqliteStatements } from "./sqlite-statement-counter.js";
import { seedStorageReadFixture, type StorageReadFixture } from "./storage-read-fixture.js";
import { createDebugEventWriter } from "../../src/backend/logs/debug-events.js";

const RUNS = 1_000;
/**
 * Tables whose size does not grow with runs or the journal; every other registry table is treated as growing. The workbook
 * library is operator-sized: one row per spreadsheet the operator keeps, not one per run.
 */
const BOUNDED = new Set(["database_states", "settings", "worker_pools", "worker_slots", "auth_leases", "assistant_model_preference", "workbook_types",
  "workbook_library", "workbook_library_state"]);
const RowSchema = z.record(z.string(), z.unknown());

interface ChangeKind { readonly code: string; readonly kind: string; readonly store: "runs" | "closure"; readonly tables: readonly string[];
  readonly where?: string;
  /** For the singleton: the fields the change writes; omitted, the row keeps the same image. */
  readonly singleton?: Readonly<Record<string, string | number | null>>;
  /** Singleton fields written before the reader's cursor, so the change starts from another publication state. */
  readonly from?: Readonly<Record<string, string | number | null>> }

const KINDS: readonly ChangeKind[] = [
  { code: "a", kind: "(a) runs update (heartbeat)", store: "runs", tables: ["runs"] },
  { code: "b", kind: "(b) timeline_events append", store: "runs", tables: ["timeline_events"] },
  { code: "c", kind: "(c) commands + command_audits append", store: "closure", tables: ["commands", "command_audits"] },
  { code: "d", kind: "(d) run_search update", store: "runs", tables: ["run_search"] },
  { code: "e", kind: "(e) write_intents update + write_attempts append", store: "closure", tables: ["write_intents", "write_attempts"] },
  { code: "f", kind: "(f) database_states update (search state unchanged)", store: "runs", tables: ["database_states"] },
  { code: "g", kind: "(g) workbook_operations append", store: "closure", tables: ["workbook_operations"] },
  { code: "h", kind: "(h) settings_snapshots update", store: "runs", tables: ["settings_snapshots"] },
  // The singleton reaches other rows only through changed fields: the search publication and the profile.
  { code: "i", kind: "(i) database_states search publication ready -> invalid", store: "runs", tables: ["database_states"],
    singleton: { search_state: "invalid", search_generation: null } },
  { code: "j", kind: "(j) database_states profile change", store: "runs", tables: ["database_states"],
    singleton: { profile_id: "00000000-0000-4000-8000-000000000000" } },
  { code: "k", kind: "(k) database_states search publication invalid -> ready (rebuild completed)", store: "runs", tables: ["database_states"],
    from: { search_state: "invalid", search_generation: null }, singleton: { search_state: "ready" } },
  // Every policy and invariant scope: one same-image update of each registry table, an active run for `runs` so the worker
  // key is emitted.
  ...AuthorityTableNameSchema.options.map((table): ChangeKind => ({ code: table, kind: `update of one ${table} row`, store: "closure", tables: [table],
    ...(table === "runs" ? { where: "state IN ('claimed','validating','running')" } : {}) })),
];

/** Applies one kind's raw edit: an update of one row of each table, which fires that table's capture trigger. */
function applyChange(database: DatabaseSync, kind: ChangeKind): boolean {
  let applied = false;
  for (const name of kind.tables) {
    const table = AuthorityTableNameSchema.parse(name);
    const key = currentRowKey(table);
    const row = database.prepare(`SELECT ${key.join(",")} FROM ${table}${kind.where === undefined ? "" : ` WHERE ${kind.where}`} LIMIT 1`).get();
    if (row === undefined) continue;
    const values = key.map(column => z.union([z.string(), z.number()]).parse(RowSchema.parse(row)[column]));
    const fields = Object.entries(kind.singleton ?? {});
    const set = fields.length === 0 ? key.map(column => `${column}=${column}`).join(",") : fields.map(([field]) => `${field}=?`).join(",");
    database.prepare(`UPDATE ${table} SET ${set} WHERE ${key.map(column => `${column}=?`).join(" AND ")}`).run(...fields.map(([, value]) => value), ...values);
    applied = true;
  }
  return applied;
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

/** One SCAN line of one statement the scoped check prepared, with the change kinds that reached it. */
export interface PlanScan { readonly kinds: readonly string[]; readonly table: string; readonly growth: string; readonly plan: string; readonly sql: string }
export interface PlanAudit { readonly scans: readonly PlanScan[]; readonly routes: ReadonlyMap<string, AuthorityChangeRoute>; readonly timings: readonly string[] }
type ScanTally = Map<string, { scan: Omit<PlanScan, "kinds">; kinds: string[] }>;

function auditStore(path: string, kinds: readonly ChangeKind[], scans: ScanTally, routes: Map<string, AuthorityChangeRoute>, timings: string[], compareWholeStore: boolean): void {
  const database = new DatabaseSync(path);
  try {
    // Another process's raw writer, inside a transaction rolled back at the end: guard triggers dropped, capture triggers kept.
    database.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
    dropGuardTriggers(database);
    for (const kind of kinds) {
      database.exec("SAVEPOINT plan_case");
      try {
        const from = Object.entries(kind.from ?? {});
        if (from.length > 0) {
          const ready = z.object({ search_generation: z.number().int().nullable() }).parse(database.prepare("SELECT search_generation FROM database_states WHERE id=1").get());
          database.prepare(`UPDATE database_states SET ${from.map(([field]) => `${field}=?`).join(",")} WHERE id=1`).run(...from.map(([, value]) => value));
          if (kind.singleton?.search_state === "ready") database.prepare("UPDATE database_states SET search_generation=? WHERE id=1").run(ready.search_generation);
        }
        const cursor = logCursor(database), singleton = readSingletonImage(database);
        if (!applyChange(database, kind)) { timings.push(`${kind.kind}: skipped (no ${kind.tables.join("/")} rows in the ${kind.store} store)`); continue; }
        const entries = readAuthorityChanges(database, cursor), singletonKeys = singletonChangeKeys(singleton, readSingletonImage(database));
        const scopedStart = systemClock.monotonicMs();
        const traced = traceSqliteStatements(() => validateAuthorityChanges(database, entries, singletonKeys));
        const scopedMs = systemClock.monotonicMs() - scopedStart;
        routes.set(kind.code, traced.value);
        let comparison = "";
        if (compareWholeStore) {
          const wholeStart = systemClock.monotonicMs();
          const whole = traceSqliteStatements(() => { validateAuthorityStore(database); });
          comparison = `; whole-store ${String(whole.statements.length)} statements ${(systemClock.monotonicMs() - wholeStart).toFixed(1)} ms`;
        }
        timings.push(`${kind.kind} [${String(entries.length)} entries, ${traced.value}]: ${String(traced.statements.length)} statements ${scopedMs.toFixed(1)} ms${comparison}`);
        tallyScans(database, kind.code, traced.statements, scans);
      } finally { database.exec("ROLLBACK TO plan_case; RELEASE plan_case"); }
    }
    database.exec("ROLLBACK");
  } finally {
    database.close();
  }
}

/** Records the plan of every statement one traced check prepared, under the change kind's code. */
function tallyScans(database: DatabaseSync, code: string, statements: readonly { sql: string }[], scans: ScanTally): void {
  const seen = new Set<string>();
  for (const { sql } of statements) {
    const key = cell(sql);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const plan of explain(database, sql)) {
      const table = scanTable(plan, key);
      if (table === undefined) continue;
      const scan = { table, growth: classify(table), plan: cell(plan), sql: key };
      const id = JSON.stringify(scan);
      const tally = scans.get(id) ?? { scan, kinds: [] };
      tally.kinds.push(code);
      scans.set(id, tally);
    }
  }
}

/**
 * Commits that need the real write path while a search rebuild is in progress: (m) the peer's next build step, then (l) an
 * unrelated peer commit; (l) moves the authority generation, so no build step can follow it without a restart. Each is
 * committed by the second connection and checked from a read connection, as a reader would.
 */
const BUILDING_KINDS = Object.freeze([
  { code: "m", kind: "(m) search rebuild continuation step", commit: (fixture: StorageReadFixture) => {
    if (fixture.writer.rebuildRunSearchIndex({ limit: 100 }).state !== "building") throw new Error("the continuation finished the rebuild, so the store left the building state");
  } },
  { code: "l", kind: "(l) debug event appended during a search rebuild", commit: (fixture: StorageReadFixture) => {
    createDebugEventWriter({ repository: fixture.writer.authority.timelineEvents, clock: fixture.clock, build: "0.1.0" })
      .emit({ category: "http", phase: "failed", correlationId: "plan-audit-building" });
  } },
]);

function auditBuilding(fixture: StorageReadFixture, scans: ScanTally, routes: Map<string, AuthorityChangeRoute>, timings: string[]): void {
  if (fixture.writer.rebuildRunSearchIndex({ restart: true, limit: 100 }).state !== "building") throw new Error("the restart did not leave a build in progress");
  const database = new DatabaseSync(fixture.path, { readOnly: true });
  try {
    for (const kind of BUILDING_KINDS) {
      const cursor = logCursor(database), singleton = readSingletonImage(database);
      kind.commit(fixture);
      database.exec("BEGIN");
      try {
        const entries = readAuthorityChanges(database, cursor), singletonKeys = singletonChangeKeys(singleton, readSingletonImage(database));
        const started = systemClock.monotonicMs();
        const traced = traceSqliteStatements(() => validateAuthorityChanges(database, entries, singletonKeys));
        routes.set(kind.code, traced.value);
        timings.push(`${kind.kind} [${String(entries.length)} entries, ${traced.value}]: ${String(traced.statements.length)} statements ${(systemClock.monotonicMs() - started).toFixed(1)} ms`);
        tallyScans(database, kind.code, traced.statements, scans);
      } finally { database.exec("COMMIT"); }
    }
  } finally { database.close(); }
}

/**
 * Seeds both stores, applies every change kind and returns each scan the scoped check's statements plan, with each kind's route.
 * `compareWholeStore` also times the whole-store check after each kind, for the report only.
 */
export async function auditScopedPlans(compareWholeStore = false): Promise<PlanAudit> {
  const scans: ScanTally = new Map(), routes = new Map<string, AuthorityChangeRoute>(), timings: string[] = [];
  const fixture = await seedStorageReadFixture(RUNS);
  const closure = await seedCheckClosureStore({ activeRuns: true });
  try {
    closure.closeDatabase();
    auditStore(fixture.path, KINDS.filter(kind => kind.store === "runs"), scans, routes, timings, compareWholeStore);
    auditStore(closure.databasePath, KINDS.filter(kind => kind.store === "closure"), scans, routes, timings, compareWholeStore);
    auditBuilding(fixture, scans, routes, timings);
  } finally {
    await closure.cleanup();
    await fixture.close();
  }
  return { scans: [...scans.values()].map(({ scan, kinds }) => ({ ...scan, kinds: [...new Set(kinds)] })), routes, timings };
}

export async function runCheckClosurePlanAudit(): Promise<void> {
  const started = systemClock.monotonicMs();
  const audit = await auditScopedPlans(true);
  const order = (scan: PlanScan) => (scan.growth === "GROWING" ? 0 : 1);
  const lines = [...audit.scans].sort((a, b) => order(a) - order(b))
    .map(scan => `| ${scan.kinds.join(", ")} | ${scan.table} | ${scan.growth} | \`${scan.plan}\` | \`${scan.sql.slice(0, 160)}\` |`);
  const whole = [...audit.routes].filter(([, route]) => route === "whole").map(([code]) => code);
  process.stdout.write([
    `# Scoped check plan audit (${String(RUNS)}-run store plus the all-tables closure store; ${((systemClock.monotonicMs() - started) / 1000).toFixed(1)} s)`, "",
    "Change kinds: (a) runs update, (b) timeline_events append, (c) commands + audits append, (d) run_search update, (e) write_intents + attempts, (f) database_states, (g) workbook_operations, (h) settings_snapshots, (i) database_states search publication change, (j) database_states profile change, (k) a completed search rebuild, (l) a peer commit during a rebuild, (m) a rebuild continuation step; a table name is a same-image update of one row of that table in the closure store (an active run for runs).", "",
    `Whole-store route: ${whole.length === 0 ? "none" : whole.join(", ")}.`, "",
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
