// Query-plan audit of the statements the dashboard and the workers run against the tables that grow with runs. It collects
// every literal SQL statement `src/backend` prepares and every statement traced while the storage-read fixture serves the
// dashboard's reads and a worker's claim, heartbeat and completion, then runs EXPLAIN QUERY PLAN on each against a migrated
// empty store. The plan test (store-query-plan.test.ts) gates on it; this entry point prints the report.
// Run: TZ=UTC node_modules/.bin/tsx tests/architecture/storage/helpers/query-plan-audit.ts
import "../../../perf/fake-keychain-entry.js";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { traceSqliteStatements } from "../../../perf/sqlite-statement-counter.js";
import { seedStorageReadFixture } from "../../../perf/storage-read-fixture.js";
import { commitOf, STORAGE_READS } from "../../../perf/storage-read-benchmark.js";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

/** The tables that grow with runs, commands and the timeline: a scan of one reads every run's rows. */
export const PLAN_TABLES = Object.freeze(["runs", "commands", "command_audits", "run_checkpoints", "timeline_events", "write_intents",
  "notifications", "artifacts", "diagnostic_snapshots"] as const);

/**
 * Modules whose statements run only in maintenance (upgrade, migration, doctor, backup, restore), never from the dashboard or
 * a worker; each reads whole tables by design.
 */
export const MAINTENANCE_MODULES = Object.freeze({
  "src/backend/storage/sqlite/migrations.ts": "schema migrations rewrite whole tables once per upgrade",
  "src/backend/storage/sqlite/worker-custody-migration.ts": "migration 24 converts every slot and lease once",
  "src/backend/storage/sqlite/worker-custody-predecessor.ts": "reads a stopped pre-24 store for its upgrade",
  "src/backend/storage/sqlite/settings-record-conversion.ts": "migration 32 converts every settings record once",
  "src/backend/storage/sqlite/assistant-effort-migration.ts": "migration converts every assistant row once",
  "src/backend/storage/sqlite/assistant-grant-retirement.ts": "migration 29 retires the grant table once",
  "src/backend/storage/sqlite/evidence-schema-upgrade.ts": "the evidence upgrade reads every stored record once",
  "src/backend/storage/sqlite/pre-build-run-deletion.ts": "migration 22 deletes the pre-build runs once",
  "src/backend/storage/sqlite/storage-doctor.ts": "the storage doctor inspects every row of a stopped store",
  "src/backend/storage/sqlite/backup-service.ts": "a backup copies and verifies the whole store",
  "src/backend/storage/sqlite/backup-inspection.ts": "backup inspection verifies a whole copy",
  "src/backend/storage/sqlite/backup-inspection-worker.ts": "backup inspection verifies a whole copy",
  "src/backend/storage/sqlite/offline-restore.ts": "an offline restore replays a whole copy",
  "src/backend/storage/sqlite/restore-write-fences.ts": "a restore fences every preserved write once",
  "src/backend/storage/sqlite/upgrade-status.ts": "reads the upgrade journal of a stopped store",
} as const);

/**
 * Statements outside the maintenance modules that read every row on purpose, each with the reason it cannot use an index.
 * Keyed by the statement with its whitespace collapsed.
 */
export const WHOLE_TABLE_READS: Readonly<Record<string, string>> = Object.freeze({
  "SELECT id, request_json, parent_id FROM commands ORDER BY id": "the whole-store check proves every command group link",
  "SELECT * FROM runs ORDER BY id": "the maintenance inventory, the doctor's span and timeline inspections, the evidence upgrade, the "
    + "application quit's activity proof and readRunSummaries, which has no dashboard caller, each read every run",
  "SELECT * FROM write_intents ORDER BY id": "the maintenance inventory, the evidence upgrade and the application quit's activity proof "
    + "read every write intent",
  "SELECT * FROM run_checkpoints ORDER BY run_id,node_id": "the evidence upgrade converts every checkpoint",
  "SELECT payload_json FROM timeline_events WHERE kind='operation-confirmed' ORDER BY cursor": "the doctor's preserved-evidence inspection reads every confirmation",
  "SELECT json_extract(payload_json,'$.payload.event.runId') AS run_id FROM timeline_events WHERE kind='transaction.fenced'":
    "the doctor's preserved-evidence inspection reads every fence",
  "SELECT id, workflow, trace_id, version FROM runs ORDER BY id": "the doctor's preserved-evidence inspection reads every run",
  "SELECT coalesce(sum(state='terminal' AND json_extract(lifecycle_json,'$.lifecycle.state') IS 'terminal'),0) AS finished, coalesce(sum(NOT(state='terminal' AND json_extract(lifecycle_json,'$.lifecycle.state') IS 'terminal')),0) AS active FROM runs":
    "the run-history status counts every run in one aggregate, which no index bounds",
  "SELECT * FROM runs": "run deletion proves no retained run references the deleted cascade",
  "SELECT * FROM timeline_events": "run deletion proves no retained event references the deleted cascade",
  "SELECT id,actor_id,payload_json,publications_json FROM notifications ORDER BY created_at,id":
    "a publication's source id lives in each row's publications array, which no column indexes; record schemas are out of this audit's reach",
});

/** One statement and where it came from: `<file>:<line>` for a literal, `traced: <workload>` for a traced one. */
export interface CollectedStatement { readonly sql: string; readonly sources: readonly string[] }
/** A planned statement with its EXPLAIN QUERY PLAN lines. */
export interface PlannedStatement extends CollectedStatement { readonly plan: readonly string[] }

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function addStatement(statements: Map<string, Set<string>>, sql: string, source: string): void {
  const key = normalizeSql(sql);
  const sources = statements.get(key) ?? new Set<string>();
  sources.add(source);
  statements.set(key, sources);
}

export interface LiteralStatements {
  readonly statements: Map<string, Set<string>>;
  /** Temporary tables and their indexes, in the order the store creates them. */
  readonly tempDdl: readonly string[];
}

/** Every string-literal argument of a `.prepare(...)` call under `src/backend`, outside the maintenance modules. */
export function literalStatements(): LiteralStatements {
  const statements = new Map<string, Set<string>>(), tempDdl = new Set<string>();
  for (const path of sourceFiles(join(REPOSITORY_ROOT, "src/backend")).sort()) {
    const file = relative(REPOSITORY_ROOT, path).replaceAll("\\", "/");
    if (file in MAINTENANCE_MODULES) continue;
    const source = ts.createSourceFile(file, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text, argument = node.arguments[0];
        if (argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
          if (method === "prepare") addStatement(statements, argument.text, `${file}:${String(source.getLineAndCharacterOfPosition(argument.getStart()).line + 1)}`);
          if (method === "exec") for (const statement of argument.text.split(";")) {
            if (/^\s*CREATE (?:TEMP TABLE\b|(?:UNIQUE )?INDEX (?:IF NOT EXISTS )?temp\.)/iu.test(statement)) {
              tempDdl.add(normalizeSql(statement));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { statements, tempDdl: [...tempDdl] };
}

/** Fixture runs: enough that every read has rows to page and every worker step has a run to act on. */
const TRACED_RUNS = 30;

/**
 * Every statement prepared while the storage-read fixture serves the dashboard's reads after a worker's claim, heartbeat and
 * completion, so the statements built at run time (table names, clause lists) are planned too. Seeding is not traced: opening
 * the store runs the whole-store check, which reads every row by design.
 */
export async function tracedStatements(): Promise<Map<string, Set<string>>> {
  const statements = new Map<string, Set<string>>();
  const fixture = await seedStorageReadFixture(TRACED_RUNS);
  try {
    const record = (workload: string, work: () => void) => {
      for (const { sql } of traceSqliteStatements(work).statements) addStatement(statements, sql, `traced: ${workload}`);
    };
    for (const [id, read] of Object.entries(STORAGE_READS)) record(`dashboard ${id}`, () => { read.read(fixture); });
    for (const kind of ["heartbeat", "completion"] as const) {
      record(`worker ${kind}`, () => {
        const step = commitOf(fixture, kind);
        step.commit(0)();
        step.finish();
      });
      for (const [id, read] of Object.entries(STORAGE_READS)) record(`dashboard ${id} after a worker ${kind}`, () => { read.read(fixture); });
    }
  } finally {
    await fixture.close();
  }
  return statements;
}

/** One SCAN of a listed table that no LIMIT bounds, with the statement and every place it came from. */
export interface PlanScan { readonly table: string; readonly plan: string; readonly sql: string; readonly sources: readonly string[] }
export interface PlanAudit {
  readonly explained: number;
  /** Statements that name a listed table, each checked for scans of every listed table. */
  readonly planned: readonly PlannedStatement[];
  readonly scans: readonly PlanScan[];
  /** Statements that name a listed table but cannot be prepared on the current schema. */
  readonly unexplained: readonly (CollectedStatement & { readonly error: string })[];
}

const PlanRowSchema = z.object({ detail: z.string() });
const NAMES_LISTED_TABLE = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(?:${PLAN_TABLES.join("|")})\\b`, "iu");

/** The table a plan line scans: the alias resolved through the statement's own FROM or JOIN, undefined for any other step. */
export function scannedTable(plan: string, sql: string): string | undefined {
  const scanned = /^SCAN (\w+)/u.exec(plan)?.[1];
  if (scanned === undefined || plan.includes("VIRTUAL TABLE")) return undefined;
  const aliased = new RegExp(`\\b(?:FROM|JOIN)\\s+(\\w+)\\s+(?:AS\\s+)?${scanned}\\b`, "iu").exec(sql)?.[1];
  if (aliased !== undefined) return aliased;
  // A scan the statement does not name in its own FROM, JOIN or UPDATE comes from a trigger body.
  return new RegExp(`(?:\\b(?:FROM|JOIN|UPDATE)\\s+|,\\s*)${scanned}\\b`, "iu").test(sql) ? scanned : undefined;
}

/**
 * A finite LIMIT bounds a scan only when it stops the one SELECT that scans: no subquery or compound whose scans it cannot reach,
 * and no aggregate, grouping, DISTINCT or sort that reads every row before the limit applies.
 */
export function limitBoundsScan(sql: string, plan: readonly string[]): boolean {
  // String literals and comments go first so a quoted or commented LIMIT or parenthesis is never read as SQL.
  const bare = sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//gu, match => match.startsWith("'") ? "''" : " ");
  let outer = bare;
  for (let inner = outer.replace(/\([^()]*\)/gu, "()"); inner !== outer; inner = outer.replace(/\([^()]*\)/gu, "()")) outer = inner;
  // Only a whole trailing clause of bound parameters or non-negative integers is a finite bound: LIMIT -1, LIMIT 1 - 2 and LIMIT 0, -1 mean no limit.
  return /\bLIMIT\s+(?:\d+|\?\d*|[:@$]\w+)(?:\s+OFFSET\s+(?:\d+|\?\d*|[:@$]\w+))?\s*;?\s*$/iu.test(outer) && (bare.match(/\bSELECT\b/giu) ?? []).length === 1
    && !/\b(?:GROUP\s+BY|DISTINCT)\b|\b(?:count|sum|total|avg|min|max|group_concat|json_group_array|json_group_object)\s*\(/iu.test(outer)
    && !plan.some(line => line.startsWith("USE TEMP B-TREE"));
}

const IndexRowSchema = z.object({ name: z.string(), sql: z.string() });

/** Plans each collected statement on `database` and returns every unbounded scan of a listed table. */
export function auditPlans(database: DatabaseSync, collected: ReadonlyMap<string, ReadonlySet<string>>): PlanAudit {
  const listed = new Set<string>(PLAN_TABLES);
  // A partial index holds only the rows its WHERE admits, so walking it reads that working set, not the table.
  const partial = new Set(database.prepare("SELECT name, sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL").all()
    .map(row => IndexRowSchema.parse(row)).filter(index => /\bWHERE\b/iu.test(index.sql)).map(index => index.name));
  const scans: PlanScan[] = [], planned: PlannedStatement[] = [], unexplained: (CollectedStatement & { error: string })[] = [];
  let explained = 0;
  for (const [sql, sourceSet] of [...collected].sort(([a], [b]) => a.localeCompare(b))) {
    const sources = [...sourceSet].sort();
    const namesListed = NAMES_LISTED_TABLE.test(sql);
    let plan: string[];
    try {
      plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => PlanRowSchema.parse(row).detail);
    } catch (error) {
      if (namesListed) unexplained.push({ sql, sources, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    explained += 1;
    if (!namesListed) continue;
    planned.push({ sql, sources, plan });
    if (sql in WHOLE_TABLE_READS || limitBoundsScan(sql, plan)) continue;
    for (const line of plan) {
      const table = scannedTable(line, sql);
      const index = / USING (?:COVERING )?INDEX (\w+)/u.exec(line)?.[1];
      if (table !== undefined && listed.has(table) && (index === undefined || !partial.has(index))) scans.push({ table, plan: line, sql, sources });
    }
  }
  return { explained, planned, scans, unexplained };
}

/** Collects the literal and traced statements and plans them on a freshly migrated, empty store. */
export async function auditStoreQueryPlans(): Promise<PlanAudit> {
  const { statements: collected, tempDdl } = literalStatements();
  for (const [sql, sources] of await tracedStatements()) for (const source of sources) addStatement(collected, sql, source);
  const profile = await createBoundProfileFixture();
  try {
    AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 1000, migrationOwner: "store-query-plan-audit" },
      manualClock(new Date("2026-08-12T09:00:00.000Z"))).close();
    const database = new DatabaseSync(profile.path);
    try {
      for (const statement of tempDdl) database.exec(statement);
      return auditPlans(database, collected);
    } finally {
      database.close();
    }
  } finally {
    await profile.close();
  }
}

export async function runStoreQueryPlanAudit(): Promise<void> {
  const audit = await auditStoreQueryPlans();
  const cell = (text: string) => text.replaceAll("|", "\\|");
  process.stdout.write([
    `# Store query plan audit: ${String(audit.explained)} statements planned, ${String(audit.planned.length)} name a listed table`, "",
    "| Table | Plan line | Statement | Sources |", "|---|---|---|---|",
    ...audit.scans.map(scan => `| ${scan.table} | \`${cell(scan.plan)}\` | \`${cell(scan.sql.slice(0, 200))}\` | ${scan.sources.join(", ")} |`), "",
    "## Not plannable on the current schema", "",
    ...audit.unexplained.map(entry => `- ${entry.sources.join(", ")}: ${entry.error} — \`${entry.sql.slice(0, 160)}\``), "",
  ].join("\n"));
}

const entryPath = process.argv[1];
if (entryPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath))) {
  await runStoreQueryPlanAudit();
  process.stdout.write("", () => { process.exit(0); });
}
