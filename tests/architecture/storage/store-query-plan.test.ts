import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { QUERY_INDEXES, SQLITE_MIGRATIONS } from "../../../src/backend/storage/sqlite/migrations.js";
import { seedStorageReadFixture } from "../../perf/storage-read-fixture.js";
import { traceSqliteStatements } from "../../perf/sqlite-statement-counter.js";
import { auditPlans, auditStoreQueryPlans, literalStatements, normalizeSql, tracedStatements, WHOLE_TABLE_READS, type PlanAudit } from "./helpers/query-plan-audit.js";

const probe = (statements: readonly string[]) => new Map(statements.map(sql => [sql, new Set(["probe"])]));

describe("store query plans", () => {
  let audit: PlanAudit;
  beforeAll(async () => { audit = await auditStoreQueryPlans(); }, 120_000);

  it("plans the store's literal statements and the statements traced from the dashboard and a worker", () => {
    expect(audit.planned.length).toBeGreaterThan(150);
    const traced = new Set(audit.planned.flatMap(statement => statement.sources.filter(source => source.startsWith("traced: "))));
    expect([...traced].some(source => source.startsWith("traced: dashboard"))).toBe(true);
    expect([...traced].some(source => source.startsWith("traced: worker"))).toBe(true);
  });

  it("plans every collected statement that names a listed table", () => {
    expect(audit.unexplained.map(entry => `${entry.sources.join(", ")}: ${entry.error}`)).toEqual([]);
  });

  it("reads no listed table by a scan that no index or limit bounds", () => {
    expect(audit.scans.map(scan => `${scan.table}: ${scan.plan} <- ${scan.sql.slice(0, 160)} (${scan.sources.join(", ")})`)).toEqual([]);
  });

  it("keeps a reason only for whole-table reads that are still collected", () => {
    const planned = new Set(audit.planned.map(statement => statement.sql));
    expect(Object.keys(WHOLE_TABLE_READS).filter(sql => !planned.has(sql))).toEqual([]);
  });

  it("uses every current index added for store queries", () => {
    const unused = Object.keys(QUERY_INDEXES).filter(name =>
      !audit.planned.some(statement => statement.plan.some(line => new RegExp(` USING (?:COVERING )?INDEX ${name}\\b`, "u").test(line))));
    expect(unused).toEqual([]);
  });

  it("replays checkpoints through the table's unique key", () => {
    const replays = audit.planned.filter(statement => /FROM run_checkpoints WHERE workflow ?= ?\? AND item_id ?= ?\?/u.test(statement.sql));
    expect(replays.length).toBeGreaterThan(0);
    for (const replay of replays) expect(replay.plan.join("\n")).toMatch(/SEARCH run_checkpoints USING (?:COVERING )?INDEX sqlite_autoindex_run_checkpoints_\d/u);
  });
});

describe("the plan audit", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY, batch_id TEXT, created_at TEXT);
    CREATE TABLE run_batches(id TEXT PRIMARY KEY);
    CREATE TRIGGER run_batches_guard BEFORE INSERT ON run_batches WHEN EXISTS(SELECT 1 FROM runs WHERE batch_id=NEW.id)
    BEGIN SELECT RAISE(ABORT,'guard'); END`);

  it("fails on an unbounded scan of a listed table", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=?"])).scans.map(scan => scan.plan)).toEqual(["SCAN runs"]);
  });

  it("fails when a sort runs before the limit", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=? ORDER BY created_at LIMIT 1"])).scans).toHaveLength(1);
  });

  it("fails when an aggregate, grouping or DISTINCT reads every row before the limit", () => {
    for (const sql of ["SELECT sum(created_at) FROM runs LIMIT 1", "SELECT count(*) FROM runs WHERE batch_id=? LIMIT 1",
      "SELECT batch_id FROM runs GROUP BY batch_id LIMIT 1", "SELECT DISTINCT batch_id FROM runs LIMIT 1"]) {
      expect(auditPlans(database, probe([sql])).scans.map(scan => scan.sql)).toEqual([sql]);
    }
  });

  it("fails an outer scan when only a subquery or one arm of a compound has the limit", () => {
    for (const sql of ["SELECT * FROM runs WHERE batch_id IN (SELECT id FROM run_batches LIMIT 1)",
      "SELECT * FROM runs WHERE created_at > (SELECT created_at FROM runs LIMIT 1)",
      "SELECT id FROM run_batches UNION ALL SELECT id FROM runs WHERE batch_id=? LIMIT 1"]) {
      expect(auditPlans(database, probe([sql])).scans.map(scan => scan.table)).toContain("runs");
    }
  });

  it("fails when the statement has no finite limit clause", () => {
    for (const sql of ["SELECT * FROM runs LIMIT -1", "SELECT * FROM runs WHERE batch_id='LIMIT 1'", "SELECT * FROM runs WHERE batch_id=? LIMIT -1 OFFSET 2",
      "SELECT * FROM runs WHERE batch_id=') LIMIT 1 --' AND created_at IN ('a', 'b')",
      "SELECT * FROM runs LIMIT 1 - 2", "SELECT * FROM runs LIMIT 0, -1", "SELECT * FROM runs LIMIT 5, 1", "SELECT * FROM runs /* LIMIT 1 */", "SELECT * FROM runs -- LIMIT 1"]) {
      expect(auditPlans(database, probe([sql])).scans.map(scan => scan.sql)).toEqual([sql]);
    }
  });

  it("passes a scan a bound parameter limits", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=? LIMIT ?", "SELECT * FROM runs WHERE batch_id='x' LIMIT 500 OFFSET ?"])).scans).toEqual([]);
  });

  it("passes a scan the limit stops and a scan inside a trigger body", () => {
    expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=? LIMIT 1", "INSERT INTO run_batches(id) VALUES(?)"])).scans).toEqual([]);
  });

  it("passes a walk of a partial index, which holds only its working set", () => {
    database.exec("CREATE INDEX runs_open_batch_idx ON runs(created_at) WHERE batch_id IS NULL");
    try {
      expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id IS NULL ORDER BY created_at"])).scans).toEqual([]);
    } finally {
      database.exec("DROP INDEX runs_open_batch_idx");
    }
  });

  it("passes a search through an index", () => {
    database.exec("CREATE INDEX runs_batch_idx ON runs(batch_id)");
    try {
      expect(auditPlans(database, probe(["SELECT * FROM runs WHERE batch_id=?"])).scans).toEqual([]);
    } finally {
      database.exec("DROP INDEX runs_batch_idx");
    }
  });
});

const plan = (database: DatabaseSync, sql: string) => database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()
  .map(row => z.object({ detail: z.string() }).parse(row).detail).join("\n");

/** The shipped statements the list index migration serves, picked out of the store's source and its traced reads, and the index each plan must use. */
/** Selector, required plan, and for a plan that keeps a temporary sort the bound that keeps the sort small. */
const PINNED_PLANS: readonly (readonly [RegExp, RegExp, string?])[] = [
  [/^SELECT id, request_json, parent_id FROM commands WHERE id IN \(SELECT value FROM json_each\(\?1\)\) OR parent_id IN \(SELECT value FROM json_each\(\?1\)\)/u,
    /SEARCH commands USING INDEX commands_child_idx \(parent_id=\?\)/u, "bounded: it orders only the command groups the peer commits since this connection's last read changed, the rows the check re-derives"],
  [/^SELECT \* FROM timeline_events WHERE run_id IN \(SELECT value FROM json_each\(\?\)\) AND kind IN \('run\.queued','run\.claimed'\) ORDER BY run_id,cursor$/u,
    /SEARCH timeline_events USING INDEX timeline_run_idx \(run_id=\?\)/u],
  [/^SELECT \* FROM runs INDEXED BY runs_parent_idx WHERE parent_id IN \(SELECT value FROM json_each\(\?\)\) ORDER BY parent_id,id$/u,
    /SEARCH runs USING INDEX runs_parent_idx \(parent_id=\?\)/u],
  [/^SELECT \* FROM delegation_dependencies WHERE parent_run_id IN \(SELECT value FROM json_each\(\?\)\) ORDER BY parent_run_id,id$/u,
    /SEARCH delegation_dependencies USING INDEX dependencies_parent_order_idx \(parent_run_id=\?\)/u],
  [/^SELECT \* FROM delegation_dependencies WHERE parent_run_id = \? ORDER BY created_at, id$/u,
    /SEARCH delegation_dependencies USING INDEX dependencies_parent_run_idx \(parent_run_id=\?\)/u],
  [/^INSERT INTO canonical_run_page SELECT row_number\(\) OVER \( ORDER BY CASE priority .*,id\),id FROM runs$/u,
    /SCAN runs USING COVERING INDEX runs_queue_order_idx/u],
  [/^INSERT INTO canonical_run_page SELECT row_number\(\) OVER \( ORDER BY CASE priority .*,id\),id FROM runs WHERE workflow=\?$/u,
    /SEARCH runs USING COVERING INDEX runs_workflow_queue_order_idx \(workflow=\?\)/u],
  [/^SELECT r\.\* FROM canonical_run_page p CROSS JOIN runs r ON r\.id=p\.run_id WHERE p\.position>\? AND p\.position<=\? ORDER BY p\.position$/u,
    /^SEARCH p USING INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)\nSEARCH r USING INDEX sqlite_autoindex_runs_1 \(id=\?\)$/u],
  [/^SELECT \* FROM gate_results WHERE run_id = \? ORDER BY created_at, id$/u, /SEARCH gate_results USING INDEX gates_run_idx \(run_id=\?\)/u],
  [/^SELECT \* FROM runs WHERE owner_worker_id = \? ORDER BY created_at, id$/u, /SEARCH runs USING INDEX runs_owned_idx \(owner_worker_id=\?\)/u],
  [/^SELECT \* FROM notifications WHERE actor_id = \? ORDER BY created_at, id$/u, /SEARCH notifications USING INDEX notifications_actor_idx \(actor_id=\?\)/u],
  [/^SELECT \* FROM run_batches WHERE workflow = \? ORDER BY started_at, id$/u, /SEARCH run_batches USING INDEX run_batches_workflow_idx \(workflow=\?\)/u],
  [/^SELECT \* FROM run_failures WHERE fingerprint = \? ORDER BY created_at, id$/u, /SEARCH run_failures USING INDEX failures_fingerprint_idx \(fingerprint=\?\)/u],
  [/^SELECT count\(\*\) AS count FROM run_failures WHERE fingerprint = \?$/u, /SEARCH run_failures USING COVERING INDEX failures_fingerprint_idx \(fingerprint=\?\)/u],
  [/^SELECT \* FROM ocr_approved_snapshots WHERE run_id=\? ORDER BY created_at,id$/u, /SEARCH ocr_approved_snapshots USING INDEX ocr_approved_run_idx \(run_id=\?\)/u],
  [/^DELETE FROM debug_events WHERE run_id=\?$/u, /SEARCH debug_events USING (?:COVERING )?INDEX debug_events_run_idx \(run_id=\?\)/u],
  [/^SELECT 1 FROM commands WHERE family IN \('settings','settings-initialization'\) LIMIT 1$/u, /SEARCH commands USING (?:COVERING )?INDEX commands_\w+ \(family=\?\)/u],
];

/** Every literal statement under src/backend, the dashboard reads' traced statements, and both run-page rebuilds, which are built at run time, and the failure list. */
async function shippedStatements(): Promise<readonly string[]> {
  const statements = new Set([...literalStatements().statements.keys(), ...(await tracedStatements()).keys()]);
  const fixture = await seedStorageReadFixture(3);
  try {
    const [workflow] = fixture.reader.summaryWorkflows();
    assert.ok(workflow !== undefined);
    for (const work of [(): unknown => fixture.reader.authority.runs.listPage({ offset: 0, limit: 50 }),
      () => fixture.reader.authority.runs.listPage({ workflow, offset: 0, limit: 50 }),
      // The failure list's statement reaches prepare through a helper, so the literal collector misses it.
      () => fixture.reader.authority.failures.listByFingerprint("0".repeat(64))]) {
      for (const { sql } of traceSqliteStatements(work).statements) statements.add(normalizeSql(sql));
    }
  } finally { await fixture.close(); }
  return [...statements];
}

describe("list index plans", () => {
  it("plans each shipped list and lookup it serves through its index, with no temporary sort unless its pin names the bound", async () => {
    const shipped = await shippedStatements();
    const database = new DatabaseSync(":memory:");
    try {
      for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
      for (const statement of literalStatements().tempDdl) database.exec(statement);
      for (const [selector, expected, sortAllowed] of PINNED_PLANS) {
        const matches = shipped.filter(sql => selector.test(sql));
        const [sql] = matches;
        assert.ok(matches.length === 1 && sql !== undefined, `one shipped statement matches ${String(selector)}: ${matches.join(" | ")}`);
        const detail = plan(database, sql);
        assert.match(detail, expected, sql);
        if (sortAllowed === undefined) assert.doesNotMatch(detail, /USE TEMP B-TREE/u, sql);
      }
    } finally { database.close(); }
  }, 120_000);
});
